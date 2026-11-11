"""Write audio and word events from the same Edge TTS stream; fail if unavailable."""
import asyncio
import json
import sys
from pathlib import Path

async def main():
    import edge_tts
    text, voice, rate, pitch, audio_path, timings_path = sys.argv[1:]
    stream = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    with open(audio_path, "wb") as audio:
        async for event in stream.stream():
            if event["type"] == "audio":
                audio.write(event["data"])
            elif event["type"] == "WordBoundary":
                words.append({"text": event["text"], "startMs": event["offset"] / 10000,
                              "endMs": (event["offset"] + event["duration"]) / 10000})
    if not words or not Path(audio_path).stat().st_size:
        raise RuntimeError("TTS returned no audio or word boundaries")
    Path(timings_path).write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")

if __name__ == "__main__":
    asyncio.run(main())
