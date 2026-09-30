---
title: TherapistGPT API
colorFrom: indigo
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

API for TherapistGPT. Set these in the Space settings under Variables:

- `MODEL_ID`: your merged model, for example `your-hf-username/therapistgpt-1.5b`
- `ALLOWED_ORIGINS`: `https://garyzhang1006.github.io`
- `API_KEY` (as a Secret, not a Variable): any long random string. Paste the same value into the web app's Access key field. Without it, anyone who finds the URL can use your GPU.

On GPU hardware, also set the build argument `TORCH_INDEX` to `https://download.pytorch.org/whl/cu128`. The default CPU build works, but a 1.5B model can take longer than the web app's 60 second timeout there.

Then paste `https://<your-space>.hf.space` into the web app's settings.
