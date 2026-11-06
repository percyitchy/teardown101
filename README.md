# Teardown 101

Learn to reverse engineer any app in 12 interactive lessons.

You take apart **Pulse**, a fictional habit tracker that lives inside the page: map its screens, inspect elements, extract design tokens, read the network, infer the API, find hidden business rules, read the shipped bundle, decode its backup file format, rebuild a component and diff it, then hand a compiled `spec.md` to a coding agent.

All sound (UI clicks, chimes, request blips and a lo-fi workbench loop) is synthesized live with Web Audio, no audio files.

Everything is simulated in the browser. No real app, API or user data is touched.

## Lessons

| Observe | Intercept | Decode | Rebuild |
|---|---|---|---|
| What REA actually is | Watch the network | Read the shipped code | Rebuild and diff |
| Map every screen | Infer the API | Decode a file format | Hand it to an agent |
| Inspect the elements | Read state and storage | | |
| Extract design tokens | Find the hidden rules | | |

## Run locally

Static site, no build step:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

Fonts: Barlow, Barlow Semi Condensed, IBM Plex Mono, Inter (SIL Open Font License). Built by [@zodchiii](https://x.com/zodchiii).

The lessons are educational. Laws on reverse engineering differ by country and by each app's terms, so check before working on a real product.
