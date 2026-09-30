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
| `split_data.py` | anywhere | Builds train/val/test, keeping crisis rows in every split |
| `train_lora.py` | GPU | LoRA fine-tune of Qwen2.5-1.5B-Instruct with TRL |
| `evaluate.py` | GPU | JSON validity, crisis recall, grounding, feeling overlap |
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

## Cost and time

These are estimates, not measurements, so check the 20-example run first.

- Synthetic data: about 2.5k input and 1k output tokens per example, so 2,000 examples on `claude-opus-5-5` come to roughly $60 before thinking tokens, which are billed as output and can add a lot. The script prints its token totals at the end, so price the full run from the 20-example one. `--model claude-sonnet-5-5` halves the per-token price, and `--effort low` trims thinking.
- Training: 2,000 examples for 3 epochs on one T4 should take 40 to 70 minutes.
- Evaluation: about 5 to 15 seconds per example on a T4 with greedy decoding.

## Deploy the API

1. Create a new Space on Hugging Face with the **Docker** SDK.
2. Copy `therapistgpt/`, `serve.py` and `config.yaml` into it, then put `space/Dockerfile` and `space/README.md` at the Space root.
3. In the Space settings add the variables `MODEL_ID` (your merged model) and `ALLOWED_ORIGINS` (your GitHub Pages URL), plus a secret `API_KEY`, and a secret `HF_TOKEN` if the model repo is private.
4. In the web app, open **Settings**, paste the Space URL and the access key, and switch the engine to **Your TherapistGPT model**.

Use a small GPU Space with `TORCH_INDEX` set (see `space/README.md`). A free CPU Space starts fine, but a 1.5B model there usually needs longer than the web app's 60 second timeout, so requests would keep falling back to the on-device organizer. The server handles one request at a time and answers "busy" to the rest, and the web app falls back to its on-device organizer whenever the model is busy, slow, or down.

## Safety design

The model is small and will make mistakes, so crisis handling never depends on it alone. `safety.py` scans every input, and a match forces `needs_support` to true and swaps in a message pointing to a crisis line. The web app runs the same check (`web/js/safety.js`) before any model is involved. `validate_data.py` refuses training rows where a crisis phrase is labeled false, and `split_data.py` puts crisis rows in every split so `evaluate.py` always measures recall on them.

## What to look at in the eval report

`crisis_recall` matters most; anything below 0.95 means the training data needs more crisis examples (raise `--crisis-rate`). `valid_schema` should be above 0.98 after training. A `grounding` score that drops well below the base model's means the fine-tuned model is inventing details.
