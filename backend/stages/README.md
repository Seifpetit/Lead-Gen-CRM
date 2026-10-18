# backend/stages

Pure pipeline stages: no I/O, no database (enforced by lint). Classifiers are injected.

| Stage                   | What it does                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queryGrid.ts`          | `buildQueryGrid`: a region's bounds become map cells and, per cell, one query per French sector wording (about 4 cells x 36 wordings = 144 queries for a region). Deterministic; skips exhausted cells and wordings; uses stored leaf cells after splits. |
| `qualify.ts`            | Rules (closed, freight carrier = competitor, non-shipper such as a restaurant, sector keyword), then the `CompanyClassifier` for the rest. With no classifier, undecided places go to `review`. Returns verdict, reasons and the evidence used.           |
| `matchTitle.ts`         | Title dictionary, then role-word plus seniority-word rule, then the `TitleClassifier` for misses only. French and English. Assistants and interns are excluded without a classifier call.                                                                 |
| `verifyCurrentRole.ts`  | Current only for a position at the matched company (LinkedIn page first, then name) with no end date.                                                                                                                                                     |
| `normalizePhone.ts`     | Tunisian numbers to `+216` and 8 digits, typed mobile, landline or special; anything else is null.                                                                                                                                                        |
| `buildLeadCandidate.ts` | The best current decision-makers at a company, ranked by channel (verified email, catch-all, then LinkedIn), role, then seniority; the company's own channel as fallback; a company-only candidate when nobody fits.                                      |
| `score.ts`              | Company fit 50, contact fit 30, reachability 20. Every point carries its reason, evidence and fact/estimate label. Weights are in `SCORE_WEIGHTS`.                                                                                                        |

Rule and dictionary results are facts about a sourced value; classifier output, found emails
and the review-count size signal are estimates.

`npm run fixtures:leads -w backend` prints the fixture leads with their scores.
