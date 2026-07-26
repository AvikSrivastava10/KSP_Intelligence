# Zia AutoML — benchmark runbook

Closes row 13 of the Catalyst services table (*automated model training, tabular*) for the
case-outcome model, by **benchmarking** Zia AutoML against LightGBM rather than swapping either one
in silently. Both numbers get published on the `/audit` workspace.

> **Why a benchmark and not a replacement.** Zia AutoML trains from the console only — the docs are
> explicit: *"You cannot create, configure, or train a model using APIs."* Training is therefore a
> manual step, which makes it unsuitable as the sole path for a model that must be reproducible from
> a script. Benchmarking gives us the service adoption **and** a reproducible pipeline, and reporting
> both is a stronger claim than either alone.

---

## Already done (by the export script)

```bash
python ml/zia_benchmark.py --export
```

Produced in `ml/out/zia/`:

| File | Rows | Purpose |
|---|---|---|
| `case_outcome_train.csv` | 100,000 | upload this to AutoML (12 MB) |
| `case_outcome_holdout_features.csv` | 2,000 | score these against the trained model |
| `case_outcome_holdout.csv` | 2,000 | the same rows **with** the true label — our scoring key |

And the measured LightGBM side of the comparison, already fixed and unable to move:

```
LightGBM (matched 100k rows)   AUC 0.9704   acc 95.15%
LightGBM (shipped 1.49M rows)  AUC 0.9749   acc 95.20%
majority-class baseline                     acc 86.90%
```

The holdout is stratified (undetected base rate 0.131 preserved), seed-fixed, and asserted disjoint
from the training sample. **Only "matched" is a fair rival to Zia** — same training rows, same
holdout. "Shipped" is context: it is what the platform serves.

---

## Step 1 — train the model in the console

1. **Zia Services → AutoML → Create Model**
2. Upload `ml/out/zia/case_outcome_train.csv` (drag it in; it will be saved to a File Store folder)
3. **Save and Next**
4. Target column: **`outcome`** — Zia should detect it as *binary-class categorical* (values
   `detected` / `undetected`)
5. **Next.** Leave all offered columns selected for training — they are already the leakage-safe,
   fairness-safe filing-time feature set, and the top-N bucketing has been applied
6. Name it e.g. `ksp_case_outcome_binary`, then **Train Model**
7. When it completes, record from the **Evaluation Report**: accuracy, F1, precision, recall, and the
   **Model ID**

> Do not add or remove columns. The point of the benchmark is that both models see identical inputs;
> changing the column set breaks that and the comparison becomes meaningless.

## Step 2 — score the shared holdout

The prediction console takes one record at a time, so for 2,000 rows use the API template that
AutoML shows you (**Model Prediction → API request template**, cURL). Iterate
`case_outcome_holdout_features.csv` against it and collect the results.

Save the output as `ml/out/zia/zia_predictions.csv` with **two columns**:

```csv
row_id,p_detected
245606,0.981
...
```

- `row_id` must be copied through from the holdout file — it is the join key.
- `p_detected` is the probability of the **positive class (`detected`)**. Percentages are fine; the
  scorer divides by 100 if it sees values above 1.
- A partial scoring run still works: the scorer reports how many rows it matched and computes metrics
  on that subset rather than silently comparing different row counts.

## Step 3 — produce the verdict

```bash
python ml/zia_benchmark.py --score ml/out/zia/zia_predictions.csv
```

This scores Zia on the identical holdout, writes `ml/out/zia_benchmark.json`, and prints the
three-way table. Then re-bundle so the API serves it:

```bash
copy ml\out\zia_benchmark.json functions\crime_api\src\data\zia_benchmark.json
```

The `/audit` workspace picks it up automatically — the Zia row flips from *Configured* to *Live*, and
the benchmark table fills in.

---

## How the verdict is worded

A difference under **0.01 AUC** at n=2,000 is reported as **comparable**, not as a win for either
side, because that is inside sampling noise at this sample size. Same three-way discipline
`ml/validation.py` uses for the ground-truth tests. Whatever the outcome, both numbers are published:

- Zia wins → we adopt the Catalyst service and say so
- LightGBM wins → we keep it, having *measured* why rather than asserted it
- Comparable → the service is validated as a genuine alternative and the reproducible pipeline stays

All three are honest results. None of them require the number to come out a particular way.

## Not benchmarked: the district-risk model

`ml/risk.py` trains on a district-year panel of **124 rows**. AutoML on 124 rows would produce a
number too unstable to compare against anything, so it stays LightGBM and the reason is stated on
`/audit` rather than omitted. The case-outcome model is the platform's primary tabular model and the
one worth the benchmark.
