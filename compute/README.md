# compute/

Everything needed to build the TherapistGPT model lives in this folder. None of it is meant to run on a laptop: data generation needs an API key and network, and training needs a GPU. The easiest path is the Kaggle notebook, which runs every step in order on a free T4.

## The fast path: Kaggle

1. Open [kaggle.com/code](https://www.kaggle.com/code), click **New Notebook**, then **File > Import Notebook** and upload `kaggle_train.ipynb`.
2. In the right sidebar set **Accelerator** to GPU T4 x2 and turn **Internet** on.
3. Under **Add-ons > Secrets**, add `ANTHROPIC_API_KEY`, and `HF_TOKEN` (write scope) if you want to publish the model.
4. Run the cells top to bottom. Check the 20-example sample before generating the full 2,000.

## What each file does

| File | Runs on | Purpose |
|---|---|---|
| `therapistgpt/schema.py` | anywhere | The JSON contract every other file follows |
| `therapistgpt/prompt.py` | anywhere | System prompt and chat formatting, shared by training and inference |
| `therapistgpt/safety.py` | anywhere | Crisis phrase detector that overrides the model when it misses one |
| `therapistgpt/inference.py` | GPU | Loads a model and organizes one brain dump |
| `data/seed.jsonl` | | 12 hand-written examples; the teacher model sees two of them per request |
| `generate_synthetic.py` | anywhere with network | Uses Claude to write realistic brain dumps and their organized versions |
| `validate_data.py` | anywhere | Checks a JSONL file against the schema and flags crisis mislabels |
| `split_data.py` | anywhere | Builds train/val/test, keeping crisis rows in every split and 15% of them in test |
| `train_lora.py` | GPU | LoRA fine-tune of Qwen2.5-1.5B-Instruct with TRL |
| `evaluate.py` | GPU | JSON validity, crisis recall, grounding, feeling overlap, and crisis recall on the 141 hand-written dumps |
| `merge_and_export.py` | GPU | Merges the adapter, pushes to the Hub, notes GGUF conversion |
| `serve.py` | GPU or CPU | FastAPI endpoint the web app can call |
| `space/` | Hugging Face | Dockerfile for hosting `serve.py` on a Space |
| `config.yaml` | | Training hyperparameters |

## Running the steps by hand

```bash
pip install -r requirements.txt            # plus a CUDA build of torch if the box lacks one
export ANTHROPIC_API_KEY=...

python generate_synthetic.py --n 20        # look at data/synthetic.jsonl before going bigger
python generate_synthetic.py --n 2000
python validate_data.py data/synthetic.jsonl --drop-invalid data/synthetic.clean.jsonl
python split_data.py --inputs data/seed.jsonl data/synthetic.clean.jsonl

python evaluate.py --base-only --limit 50 --report outputs/eval_base.json
python train_lora.py --config config.yaml
python evaluate.py --adapter outputs/therapistgpt-lora/final --report outputs/eval_finetuned.json
python merge_and_export.py --adapter outputs/therapistgpt-lora/final --push your-hf-username/therapistgpt-1.5b
```

## Smoke test in CI

`.github/workflows/smoke.yml` runs every step above except data generation on a GitHub runner's CPU, whenever a pull request touches `compute/`. `train_lora.py --smoke` swaps in `trl-internal-testing/tiny-Qwen2ForCausalLM-2.5`, a random 2-layer model with the Qwen2.5 chat template, and trains it for two steps on the seed data. Its output is noise, so the job only proves that the scripts and pinned libraries still fit together: the adapter saves, `evaluate.py` writes a report with its hand-written block, the merge loads without peft, and `serve.py` answers `/health` and returns 502 for unusable output.

A run takes about two minutes. On the run that merged it, training saw 12 seed rows (2 of them crisis), the evaluation report scored the 2 test rows with a valid-JSON rate of 0.00 (expected from random weights), and the merged model loaded as a 2,435,016-parameter `Qwen2ForCausalLM`.

## Cost and time

These are estimates, not measurements, so check the 20-example run first.

- Synthetic data: about 2.5k input and 1k output tokens per example, so 2,000 examples on `claude-opus-5-5` come to roughly $60 before thinking tokens, which are billed as output and can add a lot. The script prints its token totals at the end, so price the full run from the 20-example one. `--model claude-sonnet-5-5` halves the per-token price, and `--effort low` trims thinking.
- Training: 2,000 examples for 3 epochs on one T4 should take 40 to 70 minutes.
- Evaluation: about 5 to 15 seconds per example on a T4 with greedy decoding. The 141 hand-written dumps run after the test split, which adds roughly 12 to 35 minutes; `--limit N` cuts each set to its first N rows.

## Deploy the API

1. Create a new Space on Hugging Face with the **Docker** SDK.
2. Copy `therapistgpt/`, `serve.py` and `config.yaml` into it, then put `space/Dockerfile` and `space/README.md` at the Space root.
3. In the Space settings add the variables `MODEL_ID` (your merged model) and `ALLOWED_ORIGINS` (your GitHub Pages URL), plus a secret `API_KEY`, and a secret `HF_TOKEN` if the model repo is private.
4. In the web app, open **Settings**, paste the Space URL and the access key, and switch the engine to **Your TherapistGPT model**.

Use a small GPU Space with `TORCH_INDEX` set (see `space/README.md`). A free CPU Space starts fine, but a 1.5B model there usually needs longer than the web app's 60 second timeout, so requests would keep falling back to the on-device organizer. The server handles one request at a time and answers "busy" to the rest, and the web app falls back to its on-device organizer whenever the model is busy, slow, or down.

## Safety design

The model is small and will make mistakes, so crisis handling never depends on it alone. `safety.py` scans every input, and a match forces `needs_support` to true and swaps in a message pointing to a crisis line. The web app runs the same check (`web/js/safety.js`) before any model is involved, and text it matches is sorted on the device and never sent, so the help card does not wait on a model that can take a minute to answer. `validate_data.py` refuses training rows where a crisis phrase is labeled false, and `split_data.py` puts crisis rows in every split so `evaluate.py` always measures recall on them.

## What to look at in the eval report

`crisis_recall` matters most; anything below 0.95 means the training data needs more crisis examples (raise `--crisis-rate`). Read it with `crisis_recall_95ci`: `split_data.py` puts 15% of the crisis rows in the test split, about 24 at the default mix, and a perfect 24 of 24 still only shows recall above 0.86. `crisis_precision` on that split runs high because it holds more crisis rows than real use does. `valid_schema` should be above 0.98 after training. A `grounding` score that drops well below the base model's means the fine-tuned model is inventing details.

The `handwritten` block is the more honest crisis test. It scores the 141 brain dumps in `web/tests/fixtures` (44 of them crisis), which people wrote by hand and which never go into training, while the test split comes from the same teacher as the training data. It reports three rows: the model alone, the phrase list alone, and the two together, which is what the app ships. The phrase list was tuned on every one of these dumps, so its full marks there are a ceiling; on sets it had not seen it caught 6 of 11 and then 6 of 12. The model is worth shipping for crisis handling only if `model_missed` is short, and every name in it is a wording to add to the training mix. `model_false_alarms` lists calm dumps the model flagged.
