#include "GhostWebView.h"
#include "GhostLog.h"
#include "../Core/PluginProcessor.h"

GhostWebView::GhostWebView(const Options& options, GhostSessionProcessor& processor)
    : WebBrowserComponent(options), proc(processor)
{
    tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                  .getChildFile("GhostSession");
    if (!tempDir.exists())
        tempDir.createDirectory();

    startTimerHz(30);
}

GhostWebView::~GhostWebView()
{
    stopTimer();
}

void GhostWebView::precacheFile(const juce::String& downloadUrl, const juce::String& fileName)
{
    // Download in background so it's ready when user drags
    auto destFile = tempDir.getChildFile(fileName);
    if (destFile.existsAsFile() && destFile.getSize() > 0)
    {
        const juce::ScopedLock sl(cacheLock);
        fileCache[downloadUrl] = destFile;
        return;
    }

    juce::URL url(downloadUrl);
    auto stream = url.createInputStream(
        juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
            .withConnectionTimeoutMs(15000));

    if (stream != nullptr)
    {
        juce::FileOutputStream fos(destFile);
        if (fos.openedOk())
        {
            fos.writeFromInputStream(*stream, -1);
            fos.flush();
            const juce::ScopedLock sl(cacheLock);
            fileCache[downloadUrl] = destFile;
            GhostLog::write("[WebView] Pre-cached: " + fileName + " (" + juce::String(destFile.getSize()) + " bytes)");
        }
    }
}

bool GhostWebView::pageAboutToLoad(const juce::String& newURL)
{
    if (newURL.startsWith("ghost://drag-to-daw"))
    {
        GhostLog::write("[WebView] Intercepted drag-to-daw");
        handleDragToDaw(newURL);
        return false;
    }

    if (newURL.startsWith("ghost://start-recording"))
    { handleStartRecording(); return false; }

    if (newURL.startsWith("ghost://stop-recording"))
    { handleStopRecording(); return false; }

    if (newURL.startsWith("ghost://upload-recording"))
    { handleUploadRecording(newURL); return false; }

    if (newURL.startsWith("ghost://play-recording"))
    { handlePlayRecording(); return false; }

    if (newURL.startsWith("ghost://stop-playback"))
    { handleStopPlayback(); return false; }

    if (newURL.contains("token="))
    {
        auto token = getQueryParam(newURL, "token");
        if (token.isNotEmpty())
        {
            proc.getAppState().setAuthToken(token);
            GhostLog::write("[WebView] Auth token captured (" + juce::String(token.length()) + " chars)");
        }
    }

    return true;
}

void GhostWebView::handleWebMessage(const juce::String& message)
{
    GhostLog::write("[WebView] postMessage: " + message);

    if (message == "start-recording") handleStartRecording();
    else if (message == "stop-recording") handleStopRecording();
    else if (message == "play-recording") handlePlayRecording();
    else if (message == "stop-playback") handleStopPlayback();
    else if (message.startsWith("set-token:"))
    {
        auto token = message.fromFirstOccurrenceOf(":", false, false);
        proc.getAppState().setAuthToken(token);
    }
    else if (message.startsWith("upload-recording:"))
        handleUploadRecording("ghost://upload-recording?" + message.fromFirstOccurrenceOf(":", false, false));
    else if (message.startsWith("drag-to-daw:"))
        handleDragToDaw("ghost://drag-to-daw?" + message.fromFirstOccurrenceOf(":", false, false));
}

void GhostWebView::timerCallback()
{
    float left  = juce::jlimit(0.0f, 1.0f, proc.inputLevelLeft.load(std::memory_order_relaxed));
    float right = juce::jlimit(0.0f, 1.0f, proc.inputLevelRight.load(std::memory_order_relaxed));
    bool isRec  = proc.isRecording();
    bool isPlay = proc.isPlaying();
    double playPos = proc.getPlaybackPosition();
    double playLen = proc.getPlaybackLengthSeconds();

    juce::String js = "if(window.__ghostAudioLevels__){window.__ghostAudioLevels__("
                    + juce::String(left, 4) + "," + juce::String(right, 4) + ","
                    + (isRec ? "true" : "false") + ");}";
    js += juce::String("if(window.__ghostPlaybackState__){window.__ghostPlaybackState__(")
        + (isPlay ? "true" : "false") + "," + juce::String(playPos, 4) + ","
        + juce::String(playLen, 2) + ");}";

    evaluateJavascript(js);
}

void GhostWebView::handleStartRecording() { proc.startRecording(); }

void GhostWebView::handleStopRecording()
{
    proc.stopRecording();
    auto recordedFile = proc.getLastRecordedFile();
    if (recordedFile.existsAsFile())
    {
        auto fileName = recordedFile.getFileName();
        auto sizeKB = juce::String(recordedFile.getSize() / 1024);
        juce::String js = "if(window.__ghostRecordingComplete__){window.__ghostRecordingComplete__('"
                        + fileName + "'," + sizeKB + ");}";
        evaluateJavascript(js);
    }
}

void GhostWebView::handlePlayRecording()
{
    auto recordedFile = proc.getLastRecordedFile();
    if (!recordedFile.existsAsFile() || recordedFile.getSize() == 0)
    {
        auto td = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("GhostSession");
        if (td.isDirectory())
        {
            auto files = td.findChildFiles(juce::File::findFiles, false, "recording_*.wav");
            if (!files.isEmpty()) { files.sort(); recordedFile = files.getLast(); }
        }
    }
    if (recordedFile.existsAsFile() && recordedFile.getSize() > 0)
        proc.loadAndPlay(recordedFile);
}

void GhostWebView::handleStopPlayback() { proc.stopPlayback(); }

void GhostWebView::handleUploadRecording(const juce::String& urlString)
{
    auto projectIdParam = getQueryParam(urlString, "projectId");
    auto fileNameParam = getQueryParam(urlString, "fileName");
    auto recordedFile = proc.getLastRecordedFile();
    if (!recordedFile.existsAsFile()) return;

    juce::var metadata(new juce::DynamicObject());
    metadata.getDynamicObject()->setProperty("projectId", projectIdParam);

    auto safeThis = juce::Component::SafePointer<GhostWebView>(this);
    proc.getSessionManager().getApiClient().uploadFile(
        recordedFile, metadata,
        [](float) {},
        [safeThis, fileNameParam](const ApiClient::Response& res)
        {
            juce::MessageManager::callAsync([safeThis, res, fileNameParam]()
            {
                if (safeThis == nullptr) return;
                if (res.isSuccess())
                {
                    auto fileId = res.body.getProperty("fileId", "").toString();
                    juce::String js = "if(window.__ghostUploadComplete__){window.__ghostUploadComplete__('"
                                    + fileId + "','" + fileNameParam + "');}";
                    safeThis->evaluateJavascript(js);
                }
            });
        });
}

void GhostWebView::handleDragToDaw(const juce::String& urlString)
{
    auto downloadUrl = getQueryParam(urlString, "url");
    auto fileName = getQueryParam(urlString, "fileName");

    if (downloadUrl.isEmpty() || fileName.isEmpty())
    {
        GhostLog::write("[WebView] drag-to-daw missing params");
        return;
    }

    // Check pre-cache first
    juce::File localFile;
    {
        const juce::ScopedLock sl(cacheLock);
        auto it = fileCache.find(downloadUrl);
        if (it != fileCache.end() && it->second.existsAsFile())
            localFile = it->second;
    }

    // If not cached, download now (this blocks but keeps the mouse state alive)
    if (!localFile.existsAsFile())
    {
        GhostLog::write("[WebView] File not cached, downloading: " + fileName);
        localFile = downloadToTemp(downloadUrl, fileName);
    }

    if (!localFile.existsAsFile())
    {
        GhostLog::write("[WebView] Download failed: " + fileName);
        return;
    }

    GhostLog::write("[WebView] Starting native drag: " + localFile.getFullPathName());

    // Call performExternalDragDropOfFiles DIRECTLY — no async, no timer.
    // This enters a modal drag loop while the mouse is still held.
    juce::DragAndDropContainer::performExternalDragDropOfFiles(
        { localFile.getFullPathName() }, false, this);
}

juce::String GhostWebView::getQueryParam(const juce::String& url, const juce::String& paramName)
{
    auto search = paramName + "=";
    int startIdx = url.indexOf(search);
    if (startIdx < 0) return {};
    startIdx += search.length();
    int endIdx = url.indexOf(startIdx, "&");
    if (endIdx < 0) endIdx = url.length();
    return juce::URL::removeEscapeChars(url.substring(startIdx, endIdx));
}

juce::File GhostWebView::downloadToTemp(const juce::String& downloadUrl, const juce::String& fileName)
{
    auto destFile = tempDir.getChildFile(fileName);
    if (destFile.existsAsFile() && destFile.getSize() > 0) return destFile;

    juce::URL url(downloadUrl);
    auto stream = url.createInputStream(
        juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
            .withConnectionTimeoutMs(15000));

    if (stream != nullptr)
    {
        juce::FileOutputStream fos(destFile);
        if (fos.openedOk())
        {
            fos.writeFromInputStream(*stream, -1);
            fos.flush();
            GhostLog::write("[WebView] Downloaded " + juce::String(destFile.getSize()) + " bytes");
        }
    }
    return destFile;
}
