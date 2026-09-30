# TherapistGPT

A small language model that takes a messy brain dump and lays it back out so it is easier to look at.

When depression is loud, thoughts pile up into one long paragraph: worries, chores, guilt and memories all tangled together. You paste that paragraph in, and TherapistGPT hands the same thoughts back in a few calm pieces:

- **What I'm hearing**: one or two sentences that name what's going on without judging it
- **Feelings** you named or implied
- **The threads**: related thoughts grouped together (school, people, rest, money...)
- **Things on your plate**, each with a first step small enough to try right now
- **A kinder way to hear it**: harsh things you said about yourself, answered honestly and gently
- **One small step** for the next ten minutes

If the text mentions suicide or self-harm, a support card with 988, the Crisis Text Line and international helplines appears first. That check is a plain keyword match that runs before any model, so it never depends on the model getting it right.

**Try it:** [garyzhang1006.github.io/TherapistGPT](https://garyzhang1006.github.io/TherapistGPT/)

TherapistGPT organizes words. It is not a therapist, a diagnosis, or a crisis service.

## How it works

The project has two halves.

`web/` is the app. It's plain HTML, CSS and JavaScript with no build step and no dependencies. Out of the box it sorts text with a rule-based organizer that runs entirely in the browser, so nothing typed ever leaves the device. Once you've trained the model, you paste its address into **Settings** and the app sends text to your model instead, falling back to the on-device organizer if the model is slow or down.

`compute/` builds the model. A teacher model (Claude) writes a couple of thousand realistic brain dumps together with their organized versions, a validator throws out anything malformed or mislabeled, and a LoRA fine-tune teaches [Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) to produce the same JSON. Everything there is meant to run remotely; the Kaggle notebook runs the whole pipeline on a free T4. See [`compute/README.md`](compute/README.md).

Both halves share one output contract, defined in [`compute/therapistgpt/schema.py`](compute/therapistgpt/schema.py). The web tests check the on-device organizer against the same limits, and a test fails if the crisis phrase lists in Python and JavaScript ever drift apart.

## Design choices for people who are struggling

- A dusk palette with no pure white and no alarm red, and a light "morning" theme for people who find dark screens heavy. Both themes meet WCAG AA contrast.
- One text box and one button. No accounts, streaks, scores, word counts or timers.
- The draft saves itself as you type, and clearing it can be undone.
- A larger-text toggle, full keyboard use, and no motion at all when the system asks for reduced motion.
- Copy that validates first and never lectures. Reframes avoid diagnosing ("that's depression") and avoid false cheer.
- The moon in the corner breathes at six breaths a minute, the pace of slow, calming breathing.

## Run it locally

```bash
cd web
npm start        # serves on http://localhost:8000 (python3 -m http.server)
npm test         # node's built-in test runner, no installs
```

## Train the model

Open `compute/kaggle_train.ipynb` on Kaggle, add your `ANTHROPIC_API_KEY` (and `HF_TOKEN` to publish), and run it top to bottom. [`compute/README.md`](compute/README.md) covers each script, costs, evaluation, and deploying the API to a Hugging Face Space.

## Project layout

```
web/                 static app (GitHub Pages serves this folder)
  js/organizer.js    on-device organizer
  js/safety.js       crisis phrase detection
  js/engine.js       picks on-device or your model, with fallback
  js/render.js       results view
  tests/             node --test suites
compute/             everything that needs a GPU or an API key
  therapistgpt/      shared schema, prompt, safety floor, inference
  kaggle_train.ipynb end-to-end training run
  space/             Hugging Face Space for serving
```

## License

MIT. See [LICENSE](LICENSE).
