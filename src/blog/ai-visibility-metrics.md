---
title: "Are Mentions, Citations, Recommendations, and Referrals the Same Metric?"
description: "Define AI mentions, citations, recommendations, and referrals correctly. Use this metric dictionary to avoid misleading AEO scores and claims in reporting."
date: 2026-08-31
tags: ["AEO", "ChatGPT", "Google"]
---

No. A company can be mentioned without being recommended, recommended without its own website being cited, cited without receiving a visit, and visited without generating a qualified customer. Those outcomes occur at different points in AI-mediated discovery. Combining them into one unexplained "visibility score" makes a dashboard simpler and a decision worse.

The minimum useful AI visibility report separates four metrics: mentions, citations, recommendations, and referrals. It then keeps business outcomes—engaged visits, leads, pipeline, sales influence, or retained customers—separate again.

This is not a demand for more metrics. It is a demand for correct nouns and denominators.

## The metric dictionary

| Metric | Working definition | Basic denominator | What it can tell you | What it cannot tell you |
| --- | --- | --- | --- | --- |
| Mention | The named entity appears in the answer text under a predefined matching rule | Valid answers in the relevant prompt panel | Whether the entity entered the generated response | Whether it was endorsed, sourced, accurate, or clicked |
| Citation | A visible source link appears and meets a defined target, such as any citation, the company domain, or a specific source type | Valid answers, cited answers, or all citations—state which | Which sources were exposed to the user in recorded answers | Every source or internal influence used to form the answer |
| Recommendation | The answer explicitly advises considering or choosing the entity, or includes it in a defined recommended shortlist | Valid answers where the entity was eligible | Whether the entity entered the consideration set under tested constraints | Why the system chose it or whether a user acted |
| Referral | A measurable visit or session reaches an owned property from a defined AI source | Sessions, users, or visits in the analytics system | Observable traffic delivered to the property | Whether unseen answers influenced later direct or organic behavior |

These definitions are deliberately operational. They can be coded from preserved answers and analytics without claiming access to hidden model reasoning.

## Mentions measure presence, not preference

Use a mention when the company, product, or other entity appears in the answer under a predefined matching rule. Decide in advance whether aliases, parent companies, product names, misspellings, and linked names count.

The simplest calculation is:

`Mention rate = valid answers mentioning the entity ÷ all valid answers in the relevant panel`

The phrase "relevant panel" is essential. If a company is not available in a geography, does not serve the requested segment, or fails a required product constraint, it may be ineligible for that prompt. Including obviously ineligible prompts can make a mention rate look artificially low.

A mention can be favorable, neutral, critical, or wrong. It can occur in a historical aside or a list of options the answer rejects. Do not report mention rate as recommendation share.

## Citations measure visible sourcing

[OpenAI's web-search documentation](https://developers.openai.com/api/docs/guides/tools-web-search) represents source links as citation annotations attached to parts of a response and requires developers to display them clearly and clickably. In consumer ChatGPT search, [OpenAI advises users to open citations and verify that they support the answer](https://help.openai.com/en/articles/9237897), because search results and citations can be incomplete, outdated, or incorrect.

One "citation rate" can describe several different things, so name the metric precisely:

- **Answer citation rate:** the share of valid answers containing at least one visible citation.
- **Domain citation rate:** the share of valid answers citing the company's domain at least once.
- **Citation share:** the company domain's citations divided by all visible citations in the defined dataset.
- **Source-type mix:** the distribution of visible citations across owned, editorial, institutional, review, community, retail, directory, or other predefined types.

A visible citation is evidence that the source was linked in that answer. It is not a transcript of the model's complete information path, and it does not prove that the cited page caused the conclusion.

## Recommendations measure consideration-set presence

A recommendation requires stronger language than a mention. Define it before coding. Examples that may count include "consider Brand A," "Brand A is a suitable option for this requirement," or inclusion in a clearly labeled shortlist of recommended choices. A neutral comparison table may or may not count, depending on the rubric.

The basic calculation is:

`Recommendation rate = valid eligible answers recommending the entity ÷ all valid eligible answers`

Keep explicit recommendations separate from bare shortlist presence if the commercial question demands that distinction. Also record the position only when the interface and answer format make position comparable. A bullet listed first in one response and a card displayed first in another may not carry the same meaning.

Recommendation is conditional. Geography, budget, integrations, safety requirements, audience, and journey stage can change eligibility. Report those conditions beside the number.

## Referrals measure visits, with attribution limits

[OpenAI tells publishers that ChatGPT referral URLs include `utm_source=chatgpt.com`, enabling referral traffic to be tracked in analytics tools](https://help.openai.com/en/articles/12627856). A referral is therefore a downstream, owned-site measure: a visit or session that the analytics implementation attributes to a defined AI source.

The unit needs to be explicit. Google's own measurement guidance distinguishes [Search Console clicks from Google Analytics sessions](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console) and explains that the systems count differently. The same discipline applies to AI referrals. A dashboard should not use "clicks," "users," "sessions," and "visits" interchangeably.

Referral data also has blind spots. A buyer can read an answer and later type the company URL, use a search engine, ask a colleague, or return on another device. That influence may be real and unobserved. Conversely, an AI referral may be accidental or unqualified. Traffic is closer to business value than a mention, but it is not revenue.

## An illustrative report

The following numbers are hypothetical. They show how the metrics can tell different stories.

Imagine 20 valid consumer-interface answers to a predefined set of B2B software questions:

| Outcome | Illustrative result | Correct reading |
| --- | --- | --- |
| Mentions | 12 of 20 answers | The company appeared in 60% of these recorded answers |
| Recommendations | 5 of 20 eligible answers | It entered a recommended consideration set in 25% of the panel |
| Company-domain citations | 3 of 20 answers | Its owned domain was visibly cited in 15% of answers |
| All visible citations | 34 links | The source set can be classified and inspected; this is not an answer-level denominator |
| Referrals | 7 analytics sessions | The site recorded 7 attributed sessions in the stated period; this is not 35% "conversion" from the 20 audit answers |

The audit answers are controlled observations. The analytics sessions come from real audience activity over time. They do not share a denominator and should not be placed in one funnel as if the 20 test answers produced the 7 visits.

## Which metric should drive which decision?

| Decision | Primary metric | Supporting evidence |
| --- | --- | --- |
| "Are we entering relevant answers?" | Mention rate | Accuracy, prompt segment, and stability |
| "Are we entering the shortlist?" | Recommendation rate | Eligibility, rationale, and position where comparable |
| "Which public sources are visible?" | Citation rate and source-type mix | Claim-source fit, freshness, and recurring domains |
| "Does the channel deliver visitors?" | Referral sessions or users | Landing page, engagement, and conversion quality |
| "Is this worth more budget?" | Qualified downstream outcome | Cost, opportunity cost, assisted influence, and test design |

A citation-focused content team may reasonably prioritize source inclusion. A CMO deciding budget should not stop there. The reporting ladder should move from observable answer behavior toward customer and commercial outcomes without claiming perfect attribution.

## Common metric failures

Most misleading reports make one of five moves:

- **Undefined score:** several outcomes are weighted into one index without disclosing the formula or rationale.
- **Missing denominator:** a percentage appears without the number of prompts, runs, errors, or eligible observations.
- **Mixed surfaces:** results from consumer products and APIs are aggregated as though they represent one experience.
- **Metric substitution:** mentions become "recommendations," citations become "visibility," or referrals become "revenue influence."
- **False causality:** a metric rises after work was performed, and the report treats sequence as proof that the work caused the rise.

An aggregate can be useful for internal monitoring if every component, weight, and limitation is visible. It should never erase the raw outcomes needed to diagnose a change.

## What to put on the dashboard

For each platform and buyer-question segment, report valid runs, errors, mentions, explicit recommendations, citations, material accuracy issues, and stability over time. Show raw counts beside rates. Keep consumer surfaces separate before considering an aggregate.

Then add referrals and downstream outcomes from the analytics system with their own time period and attribution rules. The result is a measurement chain, not a magic score.

If you are designing a study, build the [buyer-question prompt panel](/blog/buyer-question-prompt-panel/) before choosing a defensible number of prompts and repeated runs or deciding which percentages to calculate.

## Sources and methodology

We reviewed [OpenAI's ChatGPT search guidance](https://help.openai.com/en/articles/9237897), [OpenAI's web-search API documentation](https://developers.openai.com/api/docs/guides/tools-web-search), [OpenAI's publisher FAQ](https://help.openai.com/en/articles/12627856), and [Google's explanation of Search Console and Google Analytics metrics](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console) on August 31, 2026. The metric definitions, formulas, and decision table are AgenQuest working standards. The numerical report is illustrative and contains no observed company data.

## About this analysis

AgenQuest Research produced this independent analysis from public documentation. No platform sponsored or participated in it.
