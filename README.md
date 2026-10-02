# ClearTalk AI

## AI-Powered Speech Analyzer for English Communication

ClearTalk AI is a web-based speech analysis application designed to help users improve their English communication skills through speech transcription, grammar analysis, filler word detection, speech metrics, and actionable feedback.

The application allows users to record their speech directly through the browser, upload an audio file, or provide text for analysis.

---

## Overview

ClearTalk AI combines browser-based speech recognition, audio recording, audio analysis, and grammar checking to provide users with meaningful feedback on their speaking patterns.

The application focuses on identifying common speaking issues such as:

- Grammar mistakes
- Frequent filler words
- Speech-related metrics
- Areas for improvement in spoken communication

---

## Key Features

### Speech Recording

Records speech directly from the user's microphone using the browser's MediaRecorder API.

### Speech Transcription

Converts spoken content into text using the browser's Speech Recognition API.

### Audio File Analysis

Supports uploading audio files in formats including:

- WAV
- MP3
- OGG
- WEBM

### Grammar Analysis

Analyzes the transcribed text using the LanguageTool API and identifies potential grammar issues.

### Filler Word Detection

Detects commonly used filler words and expressions such as:

`um`, `uh`, `like`, `basically`, `actually`, `you know`, `I mean`, `kind of`, and `sort of`.

### Speech Metrics

Analyzes speech-related information and presents the results through a structured interface.

### Feedback and Suggestions

Provides suggestions based on the analysis to help users improve their speaking habits.

---

## How It Works

```text
User Input
    |
    +-- Record Speech
    |
    +-- Upload Audio
    |
    +-- Provide Text
    |
    v
Speech Recognition / Text Processing
    |
    v
Transcription
    |
    +-------------------+
    |                   |
    v                   v
Grammar Analysis    Filler Detection
    |                   |
    +---------+---------+
              |
              v
        Speech Metrics
              |
              v
      Feedback and Suggestions
```

---

## Technology Stack

| Technology        | Purpose                               |
| ----------------- | ------------------------------------- |
| HTML5             | Application structure                 |
| CSS3              | User interface and responsive styling |
| JavaScript        | Application logic and interaction     |
| Web Speech API    | Speech recognition and transcription  |
| MediaRecorder API | Browser-based audio recording         |
| Web Audio API     | Audio analysis                        |
| LanguageTool API  | Grammar checking                      |

---

## Project Structure

```text
cleartalk-ai/
|
├── index.html
├── styles.css
├── app.js
└── README.md
```

### File Description

**index.html**
Contains the structure and user interface of the application.

**styles.css**
Contains the visual design, layout, responsive styling, and interface components.

**app.js**
Contains the application's core functionality including recording, speech recognition, audio processing, filler word detection, grammar analysis, and result handling.

---

## Getting Started

### Prerequisites

A modern web browser with support for the required browser APIs.

### Run Locally

Clone the repository:

```bash
git clone https://github.com/Ramalakshmi-21/cleartalk-ai.git
```

Navigate to the project directory:

```bash
cd cleartalk-ai
```

Open `index.html` in a supported browser.

For development, the project can also be opened using the Live Server extension in Visual Studio Code.

---

## Browser Permissions

The recording functionality requires microphone access.

When prompted by the browser, allow microphone permission to use the speech recording features.

Speech recognition behavior may vary depending on browser support.

---

## Limitations

- Speech recognition accuracy depends on browser support, microphone quality, background noise, and pronunciation.
- Grammar analysis depends on the LanguageTool API.
- Browser implementations of speech recognition may differ between browsers.
- Audio and speech analysis results may vary depending on the quality of the input.

---

## Future Enhancements

- Improved speech recognition accuracy
- Pronunciation analysis
- Personalized speaking scores
- User progress tracking
- Historical speech analysis
- AI-powered personalized recommendations
- Support for additional accents and languages

---

## Learning Outcomes

This project provided practical experience in:

- Frontend web development
- JavaScript programming
- Browser APIs
- Speech recognition
- Audio recording and processing
- REST API integration
- Text analysis
- Responsive user interface development

---
