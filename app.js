/* ========================================
   SpeechLens — Main Application Logic
   ======================================== */

(function () {
  "use strict";

  // ==========================================
  // Constants
  // ==========================================
  const FILLER_WORDS = [
    "um",
    "uh",
    "uhh",
    "umm",
    "erm",
    "ah",
    "ahh",
    "aah",
    "like",
    "literally",
    "basically",
    "actually",
    "honestly",
    "obviously",
    "you know",
    "i mean",
    "kind of",
    "sort of",
    "right",
    "so yeah",
    "you see",
    "well",
    "anyway",
    "whatever",
    "stuff like that",
  ];

  const FILLER_SINGLE_WORDS = [
    "um",
    "uh",
    "uhh",
    "umm",
    "erm",
    "ah",
    "ahh",
    "aah",
    "like",
    "literally",
    "basically",
    "actually",
    "honestly",
    "obviously",
    "right",
    "well",
    "anyway",
    "whatever",
  ];

  const FILLER_PHRASES = [
    "you know",
    "i mean",
    "kind of",
    "sort of",
    "so yeah",
    "you see",
    "stuff like that",
  ];

  const LANGUAGETOOL_API = "https://api.languagetool.org/v2/check";

  let currentTab = "record";
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let timerInterval = null;
  let audioStream = null;
  let analyserNode = null;
  let animationFrameId = null;
  let uploadedFile = null;
  let recordingDurationMs = 0;
  let liveTranscript = "";
  let liveRecognition = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      currentTab = tab;

      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      $(`#panel-${tab}`).classList.add("active");
    });
  });

  // ==========================================
  // Audio Recording
  // ==========================================
  const recordBtn = $("#record-btn");
  const recordTimer = $("#record-timer");
  const recordHint = $("#record-hint");
  const waveformCanvas = $("#waveform-canvas");
  const waveformCtx = waveformCanvas.getContext("2d");

  recordBtn.addEventListener("click", toggleRecording);

  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up audio analyser for waveform
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(audioStream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);

      mediaRecorder = new MediaRecorder(audioStream);
      audioChunks = [];
      liveTranscript = "";

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        audioStream.getTracks().forEach((t) => t.stop());
      };

      // Start live speech recognition alongside recording
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        liveRecognition = new SpeechRecognition();
        liveRecognition.continuous = true;
        liveRecognition.interimResults = false;
        liveRecognition.lang = "en-US";

        liveRecognition.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              liveTranscript += event.results[i][0].transcript + " ";
            }
          }
        };

        liveRecognition.onerror = (event) => {
          console.warn("Live recognition error:", event.error);
          // Restart on recoverable errors
          if (event.error === "no-speech" || event.error === "aborted") {
            if (isRecording) {
              try {
                liveRecognition.start();
              } catch (e) {}
            }
          }
        };

        // Auto-restart if recognition ends mid-recording (browser timeout)
        liveRecognition.onend = () => {
          if (isRecording) {
            try {
              liveRecognition.start();
            } catch (e) {}
          }
        };

        liveRecognition.start();
      }

      mediaRecorder.start();
      isRecording = true;
      recordingStartTime = Date.now();

      recordBtn.classList.add("recording");
      recordHint.textContent = "Recording & transcribing live... Click to stop";

      // Start timer
      timerInterval = setInterval(updateTimer, 100);

      // Start waveform animation
      drawWaveform();
    } catch (err) {
      console.error("Microphone access error:", err);
      recordHint.textContent =
        "⚠️ Microphone access denied. Please allow microphone access.";
    }
  }

  function stopRecording() {
    isRecording = false;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    // Stop live recognition
    if (liveRecognition) {
      try {
        liveRecognition.stop();
      } catch (e) {}
    }

    recordingDurationMs = Date.now() - recordingStartTime;

    recordBtn.classList.remove("recording");
    const wordCount = liveTranscript
      .trim()
      .split(/\s+/)
      .filter((w) => w).length;
    recordHint.textContent = `✅ Captured ${wordCount} words. Click Analyze Speech to proceed.`;

    clearInterval(timerInterval);
    cancelAnimationFrame(animationFrameId);
    drawIdleWaveform();
  }

  function updateTimer() {
    const elapsed = Date.now() - recordingStartTime;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    recordTimer.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  // ==========================================
  // Waveform Visualization
  // ==========================================
  function resizeCanvas() {
    const container = $("#waveform-container");
    waveformCanvas.width = container.clientWidth;
    waveformCanvas.height = 100;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  function drawWaveform() {
    if (!analyserNode) return;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);

    waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);

    // Gradient line
    const gradient = waveformCtx.createLinearGradient(
      0,
      0,
      waveformCanvas.width,
      0,
    );
    gradient.addColorStop(0, "#6c63ff");
    gradient.addColorStop(0.5, "#a855f7");
    gradient.addColorStop(1, "#00d4aa");

    waveformCtx.lineWidth = 2;
    waveformCtx.strokeStyle = gradient;
    waveformCtx.beginPath();

    const sliceWidth = waveformCanvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * waveformCanvas.height) / 2;
      if (i === 0) {
        waveformCtx.moveTo(x, y);
      } else {
        waveformCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
    waveformCtx.stroke();

    if (isRecording) {
      animationFrameId = requestAnimationFrame(drawWaveform);
    }
  }

  function drawIdleWaveform() {
    waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    const gradient = waveformCtx.createLinearGradient(
      0,
      0,
      waveformCanvas.width,
      0,
    );
    gradient.addColorStop(0, "rgba(108,99,255,0.3)");
    gradient.addColorStop(1, "rgba(0,212,170,0.3)");

    waveformCtx.strokeStyle = gradient;
    waveformCtx.lineWidth = 1.5;
    waveformCtx.beginPath();
    waveformCtx.moveTo(0, waveformCanvas.height / 2);
    waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
    waveformCtx.stroke();
  }
  drawIdleWaveform();

  // ==========================================
  // File Upload
  // ==========================================
  const uploadArea = $("#upload-area");
  const fileInput = $("#audio-file-input");
  const uploadedFileEl = $("#uploaded-file");
  const uploadedFileName = $("#uploaded-file-name");
  const removeFileBtn = $("#remove-file-btn");

  uploadArea.addEventListener("click", () => fileInput.click());

  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("drag-over");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("drag-over");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  const audioPlayerWrapper = $("#audio-player-wrapper");
  const uploadedAudioPlayer = $("#uploaded-audio-player");
  const transcribeBtn = $("#transcribe-btn");
  const transcribeHint = $("#transcribe-hint");
  const transcribeProgress = $("#transcribe-progress");
  const transcribeProgressFill = $("#transcribe-progress-fill");
  const transcribeStatus = $("#transcribe-status");
  const transcribeResult = $("#transcribe-result");
  const uploadTranscriptText = $("#upload-transcript-text");

  let uploadedFileObjectURL = null;
  let uploadedFileDurationMs = 0;

  function handleFileUpload(file) {
    if (!file.type.startsWith("audio/")) {
      alert("Please upload an audio file (WAV, MP3, OGG, WEBM).");
      return;
    }
    uploadedFile = file;
    uploadedFileName.textContent = file.name;
    uploadArea.style.display = "none";
    uploadedFileEl.style.display = "flex";

    // Create object URL and attach to audio player
    if (uploadedFileObjectURL) URL.revokeObjectURL(uploadedFileObjectURL);
    uploadedFileObjectURL = URL.createObjectURL(file);
    uploadedAudioPlayer.src = uploadedFileObjectURL;
    audioPlayerWrapper.style.display = "";

    // Reset transcription UI
    transcribeProgress.style.display = "none";
    transcribeResult.style.display = "none";
    transcribeBtn.style.display = "";
    transcribeHint.style.display = "";
    transcribeHint.textContent = "Click to extract text from your audio file";
    uploadTranscriptText.value = "";
    uploadedFileDurationMs = 0;

    // Get duration once metadata loads
    uploadedAudioPlayer.onloadedmetadata = () => {
      uploadedFileDurationMs = uploadedAudioPlayer.duration * 1000;
    };
  }

  removeFileBtn.addEventListener("click", () => {
    uploadedFile = null;
    fileInput.value = "";
    uploadArea.style.display = "";
    uploadedFileEl.style.display = "none";
    audioPlayerWrapper.style.display = "none";
    if (uploadedFileObjectURL) {
      URL.revokeObjectURL(uploadedFileObjectURL);
      uploadedFileObjectURL = null;
    }
    uploadedAudioPlayer.src = "";
    uploadTranscriptText.value = "";
    uploadedFileDurationMs = 0;
  });

  // ==========================================
  // Transcribe Uploaded Audio File
  // ==========================================
  transcribeBtn.addEventListener("click", transcribeUploadedAudio);

  function transcribeUploadedAudio() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(
        "Your browser does not support Speech Recognition. Please try Chrome or Edge.",
      );
      return;
    }

    transcribeBtn.style.display = "none";
    transcribeHint.style.display = "none";
    transcribeProgress.style.display = "";
    transcribeResult.style.display = "none";
    transcribeProgressFill.style.width = "5%";
    transcribeStatus.textContent = "Preparing audio...";
    uploadTranscriptText.value = "";

    let collectedText = "";
    let recognition = null;
    let audioCtx = null;
    let sourceNode = null;
    let destinationNode = null;

    // Read file as ArrayBuffer, decode via AudioContext,
    // then route through MediaStreamDestination → SpeechRecognition
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(e.target.result);
        destinationNode = audioCtx.createMediaStreamDestination();
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(destinationNode);
        // Also connect to speakers so user can hear it
        sourceNode.connect(audioCtx.destination);

        const totalDuration = audioBuffer.duration; // seconds
        uploadedFileDurationMs = totalDuration * 1000;

        // Start progress animation
        const startTime = Date.now();
        const progressInterval = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          const pct = Math.min(5 + (elapsed / totalDuration) * 90, 95);
          transcribeProgressFill.style.width = pct + "%";
          transcribeStatus.textContent = `Transcribing... ${Math.floor(elapsed)}s / ${Math.floor(totalDuration)}s`;
        }, 500);

        // Set up recognition on the stream from the audio buffer
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";
        // Use the media stream from AudioContext
        if (recognition.hasOwnProperty("stream") !== undefined) {
          // Some browsers support stream property
        }

        recognition.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              collectedText += event.results[i][0].transcript + " ";
              uploadTranscriptText.value = collectedText.trim();
            }
          }
        };

        recognition.onerror = (event) => {
          if (event.error !== "no-speech" && event.error !== "aborted") {
            console.warn("Recognition error:", event.error);
          }
        };

        recognition.onend = () => {
          // Restart until audio finishes
          if (sourceNode && audioCtx && audioCtx.state !== "closed") {
            try {
              recognition.start();
            } catch (e) {}
          }
        };

        recognition.start();

        sourceNode.onended = () => {
          clearInterval(progressInterval);
          // Stop recognition after a short delay to capture last words
          setTimeout(() => {
            try {
              recognition.stop();
            } catch (e) {}
            try {
              audioCtx.close();
            } catch (e) {}
            sourceNode = null;

            transcribeProgressFill.style.width = "100%";
            transcribeStatus.textContent = "Transcription complete!";

            setTimeout(() => {
              transcribeProgress.style.display = "none";
              transcribeResult.style.display = "";
              transcribeBtn.style.display = "";
              transcribeBtn.textContent = "🔄 Re-transcribe";
              transcribeHint.style.display = "";
              transcribeHint.textContent =
                "✅ Done! Edit the text if needed, then click Analyze Speech.";
              if (!uploadTranscriptText.value.trim()) {
                uploadTranscriptText.value = "";
                transcribeHint.textContent =
                  "⚠️ No speech detected. You can type or paste the transcript manually.";
              }
            }, 600);
          }, 1500);
        };

        sourceNode.start(0);
      } catch (err) {
        console.error("Transcription error:", err);
        transcribeProgress.style.display = "none";
        transcribeBtn.style.display = "";
        transcribeHint.style.display = "";
        transcribeHint.textContent =
          "⚠️ Could not decode audio. Try a different format.";
        alert("Audio decoding failed: " + err.message);
      }
    };
    reader.readAsArrayBuffer(uploadedFile);
  }

  // ==========================================
  // Speech-to-Text — Live capture during recording
  // (Web Speech API only listens to the mic,
  //  so we capture text WHILE recording, not after)
  // ==========================================

  // ==========================================
  // Grammar Checking (LanguageTool API)
  // ==========================================
  async function checkGrammar(text) {
    try {
      const formData = new URLSearchParams();
      formData.append("text", text);
      formData.append("language", "en-US");
      formData.append("enabledOnly", "false");

      const response = await fetch(LANGUAGETOOL_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      if (!response.ok) throw new Error("Grammar check API failed");

      const data = await response.json();
      const allMatches = data.matches || [];

      // ── Categories to skip (formatting/style only, not real grammar) ──
      const IGNORED_CATEGORIES = [
        "CASING", // capitalisation
        "PUNCTUATION", // commas, periods
        "TYPOGRAPHY", // quotes, dashes
        "WHITESPACE", // spacing
        "COMPOUNDING", // hyphenation
      ];

      // ── Rule IDs to skip (formatting/style patterns) ──
      const IGNORED_RULE_PATTERNS = [
        "UPPERCASE_SENTENCE_START",
        "MISSING_COMMA",
        "DOUBLE_PUNCTUATION",
        "SENTENCE_WHITESPACE",
        "TOO_LONG_SENTENCE",
        "EN_QUOTES",
        "DASH_RULE",
        "COMMA_PARENTHESIS_WHITESPACE",
        "WHITESPACE_RULE",
      ];
      // NOTE: MORFOLOGIK_RULE_EN_US intentionally removed from ignore list
      // so that wrong verb forms after auxiliaries (e.g. "don't bought") are caught.

      // ── Rules that must ALWAYS be shown regardless of category ──
      // These cover the most common spoken-English grammar errors.
      const ALWAYS_SHOW_PATTERNS = [
        // Auxiliary + wrong verb form: "don't bought", "didn't went", "can goes"
        "DON_T",
        "DIDN_T",
        "DOESN_T",
        "AUXILIARY",
        "AUX_",
        // Tense errors
        "VERB_TENSE",
        "PAST_SIMPLE",
        "PAST_PERFECT",
        "PRESENT_PERFECT",
        "WRONG_PAST_TENSE",
        "PAST_TENSE",
        "SIMPLE_PAST",
        "GOED", // "goed" instead of "went"
        "IRREGULAR_VERB",
        "ED_FORM",
        // Subject-verb agreement
        "SUBJECT_VERB",
        "SVA",
        "HE_VERB",
        "SHE_VERB",
        "WAS_WERE",
        "IS_ARE",
        "HAS_HAVE",
        "DO_DOES",
        "AGREEMENT_",
        // Wrong word form / modal errors
        "MODAL_VERB",
        "GONNA",
        "WANNA",
        "PREPOSITION",
        "ARTICLE",
        "DOUBLE_NEGATION",
        "NON_STANDARD",
        "CONFUSION_",
        "COLLOQUIAL",
      ];

      return allMatches.filter((match) => {
        const catId = (match.rule?.category?.id || "").toUpperCase();
        const ruleId = (match.rule?.id || "").toUpperCase();

        // 1. Always show critical grammar rules — checked FIRST
        if (ALWAYS_SHOW_PATTERNS.some((p) => ruleId.includes(p))) return true;

        // 2. Skip pure formatting/style categories
        if (IGNORED_CATEGORIES.includes(catId)) return false;

        // 3. Skip formatting rule patterns
        if (IGNORED_RULE_PATTERNS.some((p) => ruleId.includes(p))) return false;

        // 4. Show everything else (real grammar errors)
        return true;
      });
    } catch (err) {
      console.error("Grammar check error:", err);
      return [];
    }
  }

  // ==========================================
  // Filler Word Detection
  // ==========================================
  function detectFillerWords(text) {
    const lowerText = text.toLowerCase();
    const results = {};
    let totalCount = 0;

    // Check phrases first (multi-word fillers)
    for (const phrase of FILLER_PHRASES) {
      const regex = new RegExp(
        "\\b" + phrase.replace(/\s+/g, "\\s+") + "\\b",
        "gi",
      );
      const matches = lowerText.match(regex);
      if (matches && matches.length > 0) {
        results[phrase] = matches.length;
        totalCount += matches.length;
      }
    }

    // Check single words
    const words = lowerText.split(/\s+/);
    for (const filler of FILLER_SINGLE_WORDS) {
      let count = 0;
      for (const word of words) {
        // Clean punctuation
        const clean = word.replace(/[^a-z]/g, "");
        if (clean === filler) {
          count++;
        }
      }
      if (count > 0) {
        results[filler] = (results[filler] || 0) + count;
        totalCount += count;
      }
    }

    return { breakdown: results, total: totalCount };
  }

  // ==========================================
  // Speech Metrics & Suggestions
  // ==========================================
  function calculateMetrics(text, durationMs) {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const uniqueWords = new Set(
      words.map((w) => w.toLowerCase().replace(/[^a-z']/g, "")),
    );

    const wordCount = words.length;
    const sentenceCount = sentences.length;
    const durationMin = durationMs ? durationMs / 60000 : wordCount / 150; // estimate if no duration
    const pace = durationMin > 0 ? Math.round(wordCount / durationMin) : 0;
    const avgSentenceLength =
      sentenceCount > 0 ? Math.round(wordCount / sentenceCount) : 0;
    const vocabularyRichness =
      wordCount > 0 ? ((uniqueWords.size / wordCount) * 100).toFixed(1) : 0;

    return {
      wordCount,
      sentenceCount,
      pace,
      avgSentenceLength,
      uniqueWords: uniqueWords.size,
      vocabularyRichness,
      durationMin: durationMin.toFixed(1),
    };
  }

  function generateSuggestions(text, grammarErrors, fillerData, metrics) {
    const suggestions = [];
    const wordCount = metrics.wordCount;

    // Grammar suggestions
    if (grammarErrors.length > 5) {
      suggestions.push({
        icon: "📖",
        title: "Review Your Grammar",
        text: `We detected ${grammarErrors.length} grammar issues. Consider slowing down and forming complete sentences. Practicing with reading aloud can improve grammar in spontaneous speech.`,
        priority: "high",
      });
    } else if (grammarErrors.length > 0) {
      suggestions.push({
        icon: "📖",
        title: "Minor Grammar Issues",
        text: `Found ${grammarErrors.length} grammar issue(s). Review the highlighted errors above and try to be mindful of these patterns in future speeches.`,
        priority: "medium",
      });
    } else {
      suggestions.push({
        icon: "✅",
        title: "Excellent Grammar!",
        text: "No grammar issues detected. Your sentence structure and language use are clean and clear.",
        priority: "low",
      });
    }

    // Filler word suggestions
    const fillerRatio =
      wordCount > 0 ? (fillerData.total / wordCount) * 100 : 0;
    if (fillerRatio > 10) {
      suggestions.push({
        icon: "🔇",
        title: "Reduce Filler Words Significantly",
        text: `Filler words make up ${fillerRatio.toFixed(1)}% of your speech — that's very high. Practice pausing silently instead of using "um", "uh", or "like". Try recording yourself with deliberate pauses.`,
        priority: "high",
      });
    } else if (fillerRatio > 5) {
      suggestions.push({
        icon: "🔇",
        title: "Watch Your Filler Words",
        text: `Filler words make up ${fillerRatio.toFixed(1)}% of your speech. Aim for under 5%. Replace fillers with brief pauses — silence is more powerful than "um".`,
        priority: "medium",
      });
    } else if (fillerData.total > 0) {
      suggestions.push({
        icon: "🔇",
        title: "Good Filler Word Control",
        text: `Your filler word usage is at ${fillerRatio.toFixed(1)}%, which is within acceptable range. Keep practicing to reduce them further.`,
        priority: "low",
      });
    }

    // Specific filler word tips
    if (
      fillerData.breakdown["ahh"] ||
      fillerData.breakdown["ah"] ||
      fillerData.breakdown["aah"]
    ) {
      const ahhCount =
        (fillerData.breakdown["ahh"] || 0) +
        (fillerData.breakdown["ah"] || 0) +
        (fillerData.breakdown["aah"] || 0);
      suggestions.push({
        icon: "🗣️",
        title: `"Ahh" Detected ${ahhCount} Time(s)`,
        text: 'Using "ahh" suggests hesitation or searching for words. Prepare your key points beforehand and use brief pauses instead. Think of silence as a tool, not a gap.',
        priority: ahhCount > 3 ? "high" : "medium",
      });
    }

    // Pace suggestions
    if (metrics.pace > 180) {
      suggestions.push({
        icon: "⏩",
        title: "Slow Down",
        text: `You're speaking at ${metrics.pace} words per minute — that's quite fast. The ideal range is 130–170 WPM. Slow down to improve clarity and allow your audience to absorb your message.`,
        priority: "high",
      });
    } else if (metrics.pace < 100 && metrics.pace > 0) {
      suggestions.push({
        icon: "⏪",
        title: "Pick Up the Pace",
        text: `Your speaking pace is ${metrics.pace} WPM, which is on the slower side. While pauses are valuable, try to maintain a conversational rhythm of 130–170 WPM.`,
        priority: "medium",
      });
    } else if (metrics.pace >= 100 && metrics.pace <= 180) {
      suggestions.push({
        icon: "⏱️",
        title: "Good Speaking Pace",
        text: `Your pace of ${metrics.pace} WPM is in the ideal range (130–170 WPM). This allows your audience to follow along comfortably.`,
        priority: "low",
      });
    }

    // Sentence length suggestions
    if (metrics.avgSentenceLength > 25) {
      suggestions.push({
        icon: "✂️",
        title: "Shorten Your Sentences",
        text: `Your average sentence has ${metrics.avgSentenceLength} words. Aim for 15-20 words per sentence for better clarity and engagement.`,
        priority: "medium",
      });
    }

    // Vocabulary richness
    if (parseFloat(metrics.vocabularyRichness) < 40 && wordCount > 50) {
      suggestions.push({
        icon: "📚",
        title: "Expand Your Vocabulary",
        text: `Your vocabulary richness score is ${metrics.vocabularyRichness}%. Using diverse words makes speech more engaging. Try reading more widely and using synonyms.`,
        priority: "medium",
      });
    } else if (parseFloat(metrics.vocabularyRichness) >= 60) {
      suggestions.push({
        icon: "📚",
        title: "Rich Vocabulary",
        text: `Your vocabulary richness is ${metrics.vocabularyRichness}%, which shows diverse word usage. Great job keeping your speech engaging!`,
        priority: "low",
      });
    }

    // Word count
    if (wordCount < 30) {
      suggestions.push({
        icon: "💬",
        title: "Elaborate More",
        text: "Your speech is quite short. For a thorough analysis, try speaking for at least 30 seconds to a minute.",
        priority: "low",
      });
    }

    return suggestions;
  }

  function calculateOverallScore(grammarErrors, fillerData, metrics) {
    let score = 100;
    const wordCount = metrics.wordCount;

    // Grammar penalty (up to -30)
    const grammarPenalty = Math.min(grammarErrors.length * 5, 30);
    score -= grammarPenalty;

    // Filler word penalty (up to -25)
    const fillerRatio =
      wordCount > 0 ? (fillerData.total / wordCount) * 100 : 0;
    const fillerPenalty = Math.min(fillerRatio * 3, 25);
    score -= fillerPenalty;

    // Pace penalty (up to -15)
    if (metrics.pace > 200 || (metrics.pace < 80 && metrics.pace > 0)) {
      score -= 15;
    } else if (metrics.pace > 180 || (metrics.pace < 100 && metrics.pace > 0)) {
      score -= 8;
    }

    // Sentence length penalty (up to -10)
    if (metrics.avgSentenceLength > 30) score -= 10;
    else if (metrics.avgSentenceLength > 25) score -= 5;

    // Vocabulary bonus (up to +5)
    if (parseFloat(metrics.vocabularyRichness) >= 60) score += 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ==========================================
  // Highlight Transcript
  // ==========================================
  function highlightTranscript(text, grammarErrors, fillerData) {
    let highlighted = text;

    // Highlight grammar errors
    // Sort by offset descending to preserve positions
    const sortedErrors = [...grammarErrors].sort((a, b) => b.offset - a.offset);

    for (const err of sortedErrors) {
      const start = err.offset;
      const end = err.offset + err.length;
      const errorText = text.substring(start, end);
      const replacement = `<span class="grammar-highlight" title="${escapeHtml(err.message)}">${escapeHtml(errorText)}</span>`;
      highlighted =
        highlighted.substring(0, start) +
        replacement +
        highlighted.substring(end);
    }

    // Highlight filler words (after grammar to not conflict)
    for (const filler of Object.keys(fillerData.breakdown)) {
      const regex = new RegExp(
        `\\b(${filler.replace(/\s+/g, "\\s+")})\\b`,
        "gi",
      );
      highlighted = highlighted.replace(
        regex,
        '<span class="filler-highlight">$1</span>',
      );
    }

    return highlighted;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ==========================================
  // Render Results
  // ==========================================
  function renderResults(text, grammarErrors, fillerData, metrics, score) {
    // Score ring
    const circumference = 2 * Math.PI * 52; // r=52
    const offset = circumference - (score / 100) * circumference;

    // Add SVG gradient def if not exists
    const svgEl = document.querySelector(".score-ring svg");
    if (svgEl && !svgEl.querySelector("defs")) {
      const defs = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "defs",
      );
      defs.innerHTML = `
                <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#6c63ff;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#00d4aa;stop-opacity:1" />
                </linearGradient>
            `;
      svgEl.prepend(defs);
    }

    // Animate score
    const scoreRingFill = $("#score-ring-fill");
    const overallScore = $("#overall-score");
    const scoreLabel = $("#score-label");

    setTimeout(() => {
      scoreRingFill.style.strokeDashoffset = offset;
      animateNumber(overallScore, 0, score, 1200);
    }, 300);

    if (score >= 80) scoreLabel.textContent = "Excellent!";
    else if (score >= 60) scoreLabel.textContent = "Good, keep improving";
    else if (score >= 40) scoreLabel.textContent = "Needs work";
    else scoreLabel.textContent = "Significant improvement needed";

    // Metrics
    animateNumber($("#word-count"), 0, metrics.wordCount, 800);
    animateNumber($("#grammar-errors"), 0, grammarErrors.length, 800);
    animateNumber($("#filler-count"), 0, fillerData.total, 800);
    animateNumber($("#speaking-pace"), 0, metrics.pace, 800);

    // Transcript
    $("#transcript-text").innerHTML = highlightTranscript(
      text,
      grammarErrors,
      fillerData,
    );

    // Grammar errors
    const grammarList = $("#grammar-list");
    const grammarBadge = $("#grammar-badge");
    grammarBadge.textContent = `${grammarErrors.length} issue${grammarErrors.length !== 1 ? "s" : ""}`;

    if (grammarErrors.length === 0) {
      grammarList.innerHTML = `
                <div class="grammar-no-issues">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#00d4aa" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    No grammar issues detected! Great job! 🎉
                </div>`;
    } else {
      grammarList.innerHTML = grammarErrors
        .map((err) => {
          const errorText = text.substring(err.offset, err.offset + err.length);
          const suggestions =
            err.replacements && err.replacements.length > 0
              ? err.replacements.slice(0, 3).map((r) => r.value)
              : [];
          const suggestionHtml =
            suggestions.length > 0
              ? suggestions
                  .map((s) => `<span class="fix-text">${escapeHtml(s)}</span>`)
                  .join(" / ")
              : "<span class='fix-text'>—</span>";

          // Friendly label for error type
          const ruleId = (err.rule?.id || "").toUpperCase();
          const catId = (err.rule?.category?.id || "").toUpperCase();
          const catName = err.rule?.category?.name || "Grammar";

          let friendlyType = catName;
          if (
            ruleId.includes("TENSE") ||
            ruleId.includes("PAST") ||
            ruleId.includes("PRESENT") ||
            ruleId.includes("FUTURE") ||
            ruleId.includes("IRREGULAR_VERB") ||
            ruleId.includes("ED_FORM") ||
            ruleId.includes("GOED") ||
            ruleId.includes("DON_T") ||
            ruleId.includes("DIDN_T") ||
            ruleId.includes("DOESN_T") ||
            ruleId.includes("AUX") ||
            ruleId.includes("AUXILIARY")
          ) {
            friendlyType = "⏰ Tense / Verb Form Error";
          } else if (
            ruleId.includes("SUBJECT_VERB") ||
            ruleId.includes("SVA") ||
            ruleId.includes("AGREEMENT") ||
            ruleId.includes("IS_ARE") ||
            ruleId.includes("WAS_WERE") ||
            ruleId.includes("HAS_HAVE") ||
            ruleId.includes("DO_DOES") ||
            ruleId.includes("HE_VERB") ||
            ruleId.includes("SHE_VERB")
          ) {
            friendlyType = "👥 Subject-Verb Agreement";
          } else if (ruleId.includes("ARTICLE") || ruleId.includes("A_AN")) {
            friendlyType = "📝 Article Error (a/an/the)";
          } else if (ruleId.includes("PREPOSITION")) {
            friendlyType = "🔗 Preposition Error";
          } else if (
            ruleId.includes("DOUBLE_NEGATION") ||
            ruleId.includes("NON_STANDARD")
          ) {
            friendlyType = "🚫 Non-Standard Usage";
          } else if (
            ruleId.includes("MODAL") ||
            ruleId.includes("GONNA") ||
            ruleId.includes("WANNA")
          ) {
            friendlyType = "🔧 Modal Verb Error";
          } else if (
            ruleId.includes("CONFUSION") ||
            ruleId.includes("COLLOQUIAL")
          ) {
            friendlyType = "🔄 Wrong Word Usage";
          } else if (catId === "GRAMMAR") {
            friendlyType = "📖 Grammar Error";
          }

          return `
                    <div class="grammar-item">
                        <div class="grammar-item-type">${escapeHtml(friendlyType)}</div>
                        <div class="grammar-item-message">${escapeHtml(err.message)}</div>
                        <div class="grammar-item-context">
                            <span class="error-text">${escapeHtml(errorText)}</span>
                            → ${suggestionHtml}
                        </div>
                    </div>`;
        })
        .join("");
    }

    // Filler words
    const fillerChart = $("#filler-chart");
    const fillerList = $("#filler-list");
    const fillerBadge = $("#filler-badge");
    fillerBadge.textContent = `${fillerData.total} found`;

    if (fillerData.total === 0) {
      fillerChart.innerHTML = "";
      fillerList.innerHTML = `
                <div class="filler-no-issues">
                    🎉 No filler words detected! Your speech is clean and confident.
                </div>`;
    } else {
      // Tags
      fillerChart.innerHTML = Object.entries(fillerData.breakdown)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([word, count]) => `
                    <div class="filler-tag">
                        <span class="filler-tag-word">"${escapeHtml(word)}"</span>
                        <span class="filler-tag-count">${count}</span>
                    </div>`,
        )
        .join("");

      // Bar chart
      const maxCount = Math.max(...Object.values(fillerData.breakdown));
      fillerList.innerHTML = `<div class="filler-bar-container">${Object.entries(
        fillerData.breakdown,
      )
        .sort((a, b) => b[1] - a[1])
        .map(
          ([word, count]) => `
                        <div class="filler-bar-item">
                            <span class="filler-bar-label">"${escapeHtml(word)}"</span>
                            <div class="filler-bar-track">
                                <div class="filler-bar-fill" style="width: ${(count / maxCount) * 100}%"></div>
                            </div>
                            <span class="filler-bar-value">${count}</span>
                        </div>`,
        )
        .join("")}</div>`;
    }

    // Suggestions
    const suggestions = generateSuggestions(
      text,
      grammarErrors,
      fillerData,
      metrics,
    );
    const suggestionsList = $("#suggestions-list");
    suggestionsList.innerHTML = suggestions
      .map(
        (s) => `
            <div class="suggestion-item">
                <div class="suggestion-icon">${s.icon}</div>
                <div class="suggestion-content">
                    <h4>${escapeHtml(s.title)}<span class="suggestion-priority priority-${s.priority}">${s.priority}</span></h4>
                    <p>${escapeHtml(s.text)}</p>
                </div>
            </div>`,
      )
      .join("");
  }

  function animateNumber(el, from, to, duration) {
    const start = performance.now();
    function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // ease out cubic
      el.textContent = Math.round(from + (to - from) * ease);
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // ==========================================
  // Loading State
  // ==========================================
  function showLoading(text) {
    $("#loading-section").style.display = "";
    $("#loading-text").textContent = text;
    $("#results-section").style.display = "none";
    $("#recorder").scrollIntoView({ behavior: "smooth" });

    // Animate loading bar
    const bar = $("#loading-bar-fill");
    bar.style.width = "0%";
    setTimeout(() => (bar.style.width = "30%"), 300);
  }

  function updateLoading(text, progress) {
    $("#loading-text").textContent = text;
    $("#loading-bar-fill").style.width = progress + "%";
  }

  function hideLoading() {
    $("#loading-section").style.display = "none";
  }

  // ==========================================
  // Main Analyze Flow
  // ==========================================
  const analyzeBtn = $("#analyze-btn");
  const analyzeAgainBtn = $("#analyze-again-btn");

  analyzeBtn.addEventListener("click", handleAnalyze);
  analyzeAgainBtn.addEventListener("click", () => {
    $("#results-section").style.display = "none";
    window.scrollTo({
      top: $("#recorder").offsetTop - 100,
      behavior: "smooth",
    });

    // Reset state
    audioChunks = [];
    liveTranscript = "";
    uploadedFile = null;
    recordTimer.textContent = "00:00";
    recordHint.textContent = "Click the button to start recording";
    drawIdleWaveform();

    // Reset file upload
    fileInput.value = "";
    uploadArea.style.display = "";
    uploadedFileEl.style.display = "none";

    // Reset paste
    $("#paste-text").value = "";

    // Reset score ring
    $("#score-ring-fill").style.strokeDashoffset = 326.73;
    $("#overall-score").textContent = "0";
  });

  async function handleAnalyze() {
    let text = "";
    let durationMs = 0;

    analyzeBtn.disabled = true;

    try {
      if (currentTab === "paste") {
        // Direct text input
        text = $("#paste-text").value.trim();
        if (!text) {
          alert("Please enter some text to analyze.");
          analyzeBtn.disabled = false;
          return;
        }
        durationMs = 0;

        showLoading("Analyzing your text...");
        updateLoading("Analyzing your text...", 50);
      } else if (currentTab === "record") {
        // Recorded audio — transcript was captured live during recording
        if (!liveTranscript.trim()) {
          alert(
            'No speech was detected. Please record again and speak clearly, or use the "Paste Text" tab.',
          );
          analyzeBtn.disabled = false;
          return;
        }

        showLoading("Processing your speech...");
        updateLoading("Processing transcript...", 40);

        text = liveTranscript.trim();
        durationMs = recordingDurationMs;
      } else if (currentTab === "upload") {
        // Use the transcribed text from the upload tab
        const uploadText = uploadTranscriptText
          ? uploadTranscriptText.value.trim()
          : "";
        if (!uploadedFile) {
          alert("Please upload an audio file first.");
          analyzeBtn.disabled = false;
          return;
        }
        if (!uploadText) {
          alert(
            'Please transcribe the audio first using the "Transcribe Audio" button, or type the transcript manually in the text box.',
          );
          analyzeBtn.disabled = false;
          return;
        }
        text = uploadText;
        durationMs = uploadedFileDurationMs || 0;
        showLoading("Analyzing your uploaded speech...");
        updateLoading("Processing transcript...", 40);
      }

      // Step 2: Grammar check
      updateLoading("Checking grammar...", 60);
      const grammarErrors = await checkGrammar(text);

      // Step 3: Filler detection
      updateLoading("Detecting filler words...", 80);
      const fillerData = detectFillerWords(text);

      // Step 4: Calculate metrics
      updateLoading("Calculating metrics...", 90);
      const metrics = calculateMetrics(text, durationMs);

      // Step 5: Calculate score
      const score = calculateOverallScore(grammarErrors, fillerData, metrics);

      // Step 6: Render
      updateLoading("Preparing results...", 100);

      setTimeout(() => {
        hideLoading();
        $("#results-section").style.display = "";
        renderResults(text, grammarErrors, fillerData, metrics, score);
        renderQuiz(text, grammarErrors, fillerData, metrics, score);
        $("#results-section").scrollIntoView({ behavior: "smooth" });
      }, 500);
    } catch (err) {
      console.error("Analysis error:", err);
      hideLoading();
      alert("An error occurred: " + err.message);
    }

    analyzeBtn.disabled = false;
  }

  // ==========================================
  // Quiz Generation
  // ==========================================
  let quizQuestions = [];
  let quizSubmitted = false;

  function generateQuizQuestions(
    text,
    grammarErrors,
    fillerData,
    metrics,
    score,
  ) {
    const questions = [];

    // =============================================
    // Grammar-Only Question Bank (Tense & Spelling)
    // =============================================

    // Pool of tense-related questions
    const tenseQuestions = [
      {
        question: "Choose the correct sentence (Simple Past Tense):",
        options: [
          "She goed to the market yesterday.",
          "She went to the market yesterday.",
          "She go to the market yesterday.",
          "She going to the market yesterday.",
        ],
        answer: "She went to the market yesterday.",
        explanation:
          '"Went" is the correct past tense form of "go". "Goed" is a common error — "go" is an irregular verb.',
      },
      {
        question: "Which sentence uses the Present Perfect Tense correctly?",
        options: [
          "I have ate my lunch.",
          "I have eaten my lunch.",
          "I had eat my lunch.",
          "I has eaten my lunch.",
        ],
        answer: "I have eaten my lunch.",
        explanation:
          'Present Perfect uses "have/has + past participle". The past participle of "eat" is "eaten", not "ate".',
      },
      {
        question: "Select the correct Future Tense sentence:",
        options: [
          "She will goes to school tomorrow.",
          "She will go to school tomorrow.",
          "She will going to school tomorrow.",
          "She will went to school tomorrow.",
        ],
        answer: "She will go to school tomorrow.",
        explanation:
          'After "will", always use the base form of the verb (go), not "goes", "going", or "went".',
      },
      {
        question: "Which sentence is in the Past Continuous Tense?",
        options: [
          "They were playing cricket when it rained.",
          "They played cricket when it rained.",
          "They are playing cricket when it rained.",
          "They had played cricket when it rained.",
        ],
        answer: "They were playing cricket when it rained.",
        explanation:
          'Past Continuous uses "was/were + verb-ing" to describe an ongoing action in the past that was interrupted.',
      },
      {
        question: "Choose the correct Present Continuous Tense sentence:",
        options: [
          "He is run in the park.",
          "He is running in the park.",
          "He are running in the park.",
          "He running in the park.",
        ],
        answer: "He is running in the park.",
        explanation:
          'Present Continuous requires "is/am/are + verb-ing". "He is running" is correct — "run" becomes "running".',
      },
      {
        question: "Which sentence correctly uses the Past Perfect Tense?",
        options: [
          "She had already leaved when I arrived.",
          "She had already left when I arrived.",
          "She has already left when I arrived.",
          "She have already left when I arrived.",
        ],
        answer: "She had already left when I arrived.",
        explanation:
          'Past Perfect uses "had + past participle". "Left" is the correct past participle of "leave", not "leaved".',
      },
      {
        question: "Identify the correct Simple Present Tense sentence:",
        options: [
          "He go to school every day.",
          "He goes to school every day.",
          "He going to school every day.",
          "He gone to school every day.",
        ],
        answer: "He goes to school every day.",
        explanation:
          'In Simple Present, third-person singular subjects (he/she/it) use the verb with "-s" or "-es". So "goes" is correct.',
      },
      {
        question: "Which sentence uses the Future Continuous Tense correctly?",
        options: [
          "I will be waiting for you at 5 PM.",
          "I will waiting for you at 5 PM.",
          "I will be wait for you at 5 PM.",
          "I will been waiting for you at 5 PM.",
        ],
        answer: "I will be waiting for you at 5 PM.",
        explanation:
          'Future Continuous uses "will be + verb-ing" to describe an ongoing action at a specific future time.',
      },
      {
        question: 'Choose the correct Past Tense form of "write":',
        options: ["writed", "wrote", "wroten", "writing"],
        answer: "wrote",
        explanation:
          '"Write" is an irregular verb. Its past tense is "wrote" and past participle is "written" — never "writed".',
      },
      {
        question: "Which sentence has the correct subject-verb agreement?",
        options: [
          "The team are winning the match.",
          "The team is winning the match.",
          "The team were winning the match.",
          "The team have winning the match.",
        ],
        answer: "The team is winning the match.",
        explanation:
          'Collective nouns like "team" are typically treated as singular in American English, so "is" is correct.',
      },
      {
        question: "Select the sentence with the correct tense:",
        options: [
          "If I was you, I would study harder.",
          "If I were you, I would study harder.",
          "If I am you, I would study harder.",
          "If I be you, I would study harder.",
        ],
        answer: "If I were you, I would study harder.",
        explanation:
          'The subjunctive mood uses "were" for all subjects in hypothetical/unreal conditions ("If I were…").',
      },
      {
        question:
          "Choose the correct sentence using Present Perfect Continuous:",
        options: [
          "She has been studying for three hours.",
          "She have been studying for three hours.",
          "She has being studying for three hours.",
          "She has been study for three hours.",
        ],
        answer: "She has been studying for three hours.",
        explanation:
          'Present Perfect Continuous uses "has/have + been + verb-ing" to show an action that started in the past and is still continuing.',
      },
    ];

    // Pool of spelling-related questions
    const spellingQuestions = [
      {
        question: "Which is the correct spelling?",
        options: ["Accomodate", "Accommodate", "Acommodate", "Acomodate"],
        answer: "Accommodate",
        explanation:
          '"Accommodate" has double "c" and double "m". A common spelling mistake is to use only one "m".',
      },
      {
        question: "Choose the correctly spelled word:",
        options: ["Definately", "Definatly", "Definitely", "Definetly"],
        answer: "Definitely",
        explanation:
          '"Definitely" — remember it comes from "definite" + "ly". The common error is replacing the second "i" with an "a".',
      },
      {
        question: "Which spelling is correct?",
        options: ["Seperate", "Separete", "Separate", "Seperete"],
        answer: "Separate",
        explanation:
          '"Separate" — think of "a rat" in the middle: sep-A-R-A-T-e. "Seperate" is one of the most common misspellings.',
      },
      {
        question: "Select the correctly spelled word:",
        options: ["Occurence", "Occurrence", "Occurance", "Ocurrence"],
        answer: "Occurrence",
        explanation:
          '"Occurrence" has double "c" and double "r". It follows the doubling rule when the stress falls on the second syllable.',
      },
      {
        question: "Which word is spelled correctly?",
        options: ["Grammer", "Grammar", "Gramar", "Gramer"],
        answer: "Grammar",
        explanation:
          '"Grammar" ends with "-ar", not "-er". Remember: "I need to check my grammAR" — the last vowel is A.',
      },
      {
        question: "Choose the correct spelling:",
        options: ["Recieve", "Receive", "Receeve", "Receve"],
        answer: "Receive",
        explanation:
          '"Receive" follows the rule "i before e, except after c". After the "c", it\'s "ei" not "ie".',
      },
      {
        question: "Which is spelled correctly?",
        options: [
          "Pronounciation",
          "Pronunciation",
          "Prononciation",
          "Pronanciation",
        ],
        answer: "Pronunciation",
        explanation:
          '"Pronunciation" — note there\'s no "o" after "pron". It\'s "pronun-" not "pronou-", even though the verb is "pronounce".',
      },
      {
        question: "Select the correct spelling:",
        options: ["Neccessary", "Necessary", "Necesary", "Neccesary"],
        answer: "Necessary",
        explanation:
          '"Necessary" — one "c", double "s". Remember: it\'s neCeSSary (1 Collar, 2 Socks).',
      },
      {
        question: "Which is the correct spelling?",
        options: ["Wierd", "Weird", "Weerd", "Weard"],
        answer: "Weird",
        explanation:
          '"Weird" is an exception to the "i before e" rule. It\'s one of the few words where "ei" comes without a preceding "c".',
      },
      {
        question: "Choose the correctly spelled word:",
        options: ["Enviroment", "Environment", "Envirnoment", "Environmint"],
        answer: "Environment",
        explanation:
          '"Environment" — don\'t forget the "n" before "ment". It comes from "environ" + "ment".',
      },
      {
        question: "Which word is spelled correctly?",
        options: ["Tommorrow", "Tommorow", "Tomorrow", "Tomorow"],
        answer: "Tomorrow",
        explanation:
          '"Tomorrow" — one "m", one "r", two "o"s. A simple way to remember: "Tom-or-row".',
      },
      {
        question: "Select the correct spelling:",
        options: ["Embarass", "Embarrass", "Embarras", "Embaras"],
        answer: "Embarrass",
        explanation:
          '"Embarrass" has double "r" and double "s". Remember: you get Really Red and feel So Silly when embarrassed.',
      },
    ];

    // ---- Step 1: Add questions from user's actual grammar errors (tense/spelling relevant) ----
    const usedIndices = new Set();
    for (let i = 0; i < grammarErrors.length && questions.length < 3; i++) {
      const err = grammarErrors[i];
      const errorText = text.substring(err.offset, err.offset + err.length);
      const correctText =
        err.replacements && err.replacements.length > 0
          ? err.replacements[0].value
          : null;

      if (correctText && correctText !== errorText) {
        const wrongOptions = generateGrammarWrongOptions(
          errorText,
          correctText,
          err,
        );
        questions.push({
          question: `Your speech contained "${errorText}". What is the correct form?`,
          options: shuffleArray([correctText, ...wrongOptions]),
          answer: correctText,
          explanation:
            err.message || `"${errorText}" should be "${correctText}".`,
        });
      }
    }

    // ---- Step 2: Fill remaining slots with tense questions ----
    const shuffledTense = shuffleArray([...tenseQuestions]);
    for (let i = 0; i < shuffledTense.length && questions.length < 4; i++) {
      questions.push(shuffledTense[i]);
    }

    // ---- Step 3: Fill remaining slots with spelling questions ----
    const shuffledSpelling = shuffleArray([...spellingQuestions]);
    for (let i = 0; i < shuffledSpelling.length && questions.length < 5; i++) {
      questions.push(shuffledSpelling[i]);
    }

    return questions.slice(0, 5);
  }

  function generateGrammarWrongOptions(errorText, correctText, err) {
    const options = new Set();

    // Add the original error as a wrong option
    options.add(errorText);

    // Generate plausible distractors based on common grammar mistakes
    const lower = correctText.toLowerCase();

    // Tense variations
    if (lower.endsWith("ed")) {
      options.add(correctText.replace(/ed$/, "ing"));
      options.add(correctText.replace(/ed$/, "s"));
    } else if (lower.endsWith("ing")) {
      options.add(correctText.replace(/ing$/, "ed"));
      options.add(correctText.replace(/ing$/, ""));
    } else if (lower.endsWith("s")) {
      options.add(correctText.replace(/s$/, ""));
      options.add(correctText + "ed");
    } else {
      options.add(correctText + "s");
      options.add(correctText + "ed");
    }

    // Add other replacements from the API as distractors
    if (err.replacements && err.replacements.length > 1) {
      for (let i = 1; i < Math.min(err.replacements.length, 4); i++) {
        if (err.replacements[i].value !== correctText) {
          options.add(err.replacements[i].value);
        }
      }
    }

    // Remove the correct answer and empty strings, take up to 3
    return [...options]
      .filter((o) => o !== correctText && o.trim().length > 0)
      .slice(0, 3);
  }

  function generateWrongOptions(errorText, correctText) {
    const options = [];
    // Generate plausible wrong answers
    if (correctText.length > 2) {
      options.push(errorText); // The original error itself
      options.push(correctText + "s");
      options.push(
        correctText.charAt(0).toUpperCase() + correctText.slice(1) + "ed",
      );
    } else {
      options.push(errorText);
      options.push("an");
      options.push("the");
    }
    // Deduplicate and remove correct answer
    return [...new Set(options)]
      .filter((o) => o !== correctText && o.trim().length > 0)
      .slice(0, 3);
  }

  function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function renderQuiz(text, grammarErrors, fillerData, metrics, score) {
    quizQuestions = generateQuizQuestions(
      text,
      grammarErrors,
      fillerData,
      metrics,
      score,
    );
    quizSubmitted = false;

    const container = $("#quiz-container");
    const actions = $("#quiz-actions");
    const results = $("#quiz-results");

    actions.style.display = "";
    results.style.display = "none";
    $("#quiz-submit-btn").disabled = false;

    container.innerHTML = quizQuestions
      .map(
        (q, i) => `
            <div class="quiz-question" data-index="${i}">
                <div class="quiz-q-header">
                    <div class="quiz-q-number">${i + 1}</div>
                    <div class="quiz-q-text">${escapeHtml(q.question)}</div>
                </div>
                <div class="quiz-options">
                    ${q.options
                      .map(
                        (opt, oi) => `
                        <div class="quiz-option" data-question="${i}" data-option="${oi}" data-value="${escapeHtml(opt)}">
                            <div class="quiz-radio"></div>
                            <span>${escapeHtml(opt)}</span>
                        </div>
                    `,
                      )
                      .join("")}
                </div>
                <div class="quiz-explanation">${escapeHtml(q.explanation)}</div>
            </div>
        `,
      )
      .join("");

    // Option click handlers
    container.querySelectorAll(".quiz-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        if (quizSubmitted) return;
        const qi = opt.dataset.question;
        // Deselect siblings
        container
          .querySelectorAll(`.quiz-option[data-question="${qi}"]`)
          .forEach((o) => o.classList.remove("selected"));
        opt.classList.add("selected");
      });
    });

    // Submit handler
    const submitBtn = $("#quiz-submit-btn");
    // Remove old handler by cloning
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

    newSubmitBtn.addEventListener("click", () => {
      if (quizSubmitted) return;

      // Check all questions are answered
      let allAnswered = true;
      for (let i = 0; i < quizQuestions.length; i++) {
        const selected = container.querySelector(
          `.quiz-option.selected[data-question="${i}"]`,
        );
        if (!selected) {
          allAnswered = false;
          break;
        }
      }

      if (!allAnswered) {
        alert("Please answer all 5 questions before submitting.");
        return;
      }

      quizSubmitted = true;
      newSubmitBtn.disabled = true;
      let correctCount = 0;

      quizQuestions.forEach((q, i) => {
        const qEl = container.querySelector(
          `.quiz-question[data-index="${i}"]`,
        );
        const selected = container.querySelector(
          `.quiz-option.selected[data-question="${i}"]`,
        );
        const selectedValue = selected.dataset.value;
        const isCorrect = selectedValue === q.answer;

        if (isCorrect) {
          correctCount++;
          qEl.classList.add("correct");
        } else {
          qEl.classList.add("wrong");
          selected.classList.add("wrong-answer");
        }

        // Highlight correct answer
        container
          .querySelectorAll(`.quiz-option[data-question="${i}"]`)
          .forEach((opt) => {
            if (opt.dataset.value === q.answer) {
              opt.classList.add("correct-answer");
            }
            opt.style.cursor = "default";
          });

        // Show explanation
        qEl.classList.add("answered");
      });

      // Show score
      results.style.display = "";
      const quizScoreCard = $("#quiz-score-card");
      const pct = Math.round((correctCount / quizQuestions.length) * 100);
      let label = "";
      if (pct === 100)
        label = "🎉 Perfect! You fully understand your speech analysis!";
      else if (pct >= 80)
        label = "👏 Great job! You have a strong understanding.";
      else if (pct >= 60)
        label = "👍 Good effort! Review the explanations to improve.";
      else label = "📚 Keep learning! Review the analysis results above.";

      quizScoreCard.innerHTML = `
                <div class="quiz-final-score">${correctCount}/${quizQuestions.length}</div>
                <div class="quiz-final-label">${label}</div>
            `;

      newSubmitBtn.style.display = "none";
    });
  }
})();
