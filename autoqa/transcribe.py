import json
import sys
from faster_whisper import WhisperModel


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: transcribe.py <audio.wav> [model]')
    path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else 'small.en'
    model = WhisperModel(model_name, device='cpu', compute_type='int8')
    segments, info = model.transcribe(path, vad_filter=True, beam_size=5)
    items = []
    text_parts = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            items.append({'start': round(segment.start, 2), 'end': round(segment.end, 2), 'text': text})
            text_parts.append(text)
    print(json.dumps({'text': ' '.join(text_parts).strip(), 'language': info.language, 'segments': items}, ensure_ascii=False))


if __name__ == '__main__':
    main()
