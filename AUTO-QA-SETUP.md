# Local Auto QA Setup

Auto QA is local-first. The normal QA form and exports still work the same way.

## One-time setup on the Windows QA computer

1. Install Ollama, Node.js, FFmpeg, and Python 3.11 or 3.12.
2. Run `INSTALL-AUTO-QA.bat`.
3. Run `START-AUTO-QA.bat` before using Auto QA.
4. Keep the normal QA web app running as usual.

The installer creates `.venv-autoqa` only for transcription and installs `faster-whisper`. It does not edit any existing `.env` file.

## Auto QA flow

Upload an audio call, paste the itinerary / Zendesk documentation, and click **Run Auto QA**. The local service normalizes the audio with FFmpeg, transcribes it with faster-whisper, finds the most relevant rules from the active Service Matrix, and asks the configured Ollama model to grade every criterion.

Each answer is written into the same editable QA fields used by manual QA. The evaluator can replace any status or note before saving. **Recheck QA with Ollama** re-runs the grade using the current transcript, documentation, Matrix, and QA form.

Confidence and evidence are review helpers only. They are not written into the normal QA Excel export. The final export contains the same normal QA data: final statuses, scores and notes.

## Matrix and Group Sales form

Admins can open **Admin > Auto QA** and upload a new `.xlsx` Service Matrix. The workbook is converted to text and saved in Firebase settings so future Auto QA runs use it.

The same page has a **Group Sales QA Form** upload. If a future Sales workbook contains recognizable numbered criteria and points, the tool attempts to fill the Sales criteria automatically. Otherwise the workbook is still saved as the Sales reference and criteria can be entered manually in Admin > Criteria.

## Local endpoints

Auto QA companion: `http://127.0.0.1:8788`

Ollama default: `http://127.0.0.1:11434`

Default model: `qwen3:8b`
