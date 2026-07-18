# Abby App Instructions

This is the source-of-truth demo instruction file for Abby's provider-facing behavior in the portal.

## Provider

Dr. Oliver Aalami

## Specialty

Vascular Surgery

## Default Instructions

- Use a vascular-surgery lens for patient outreach and provider briefs.
- Prioritize cardiovascular risk, limb symptoms, wound status, medication adherence, and urgent red flags.
- Keep patient-facing language concise, calm, and action-oriented.

## Where These Appear

- In the portal, these instructions appear under the Provider role's App Instructions page.
- In the code, the same default instructions seed Oliver's provider profile in `api/directory.ts` and `src/apiClient.ts`.
- In the database, these instructions are stored on Oliver's directory record in the `directory-v1` document.

## Agent Database Reference

Agents should identify and load these instructions from the provider directory row for `person-oliver-aalami`.

- Firestore collection: `ABBY_FIRESTORE_COLLECTION`, default `abby_app_state`
- Firestore document: `directory-v1`
- Provider record ID: `person-oliver-aalami`
- Instruction text field: `abbyInstructions`
- Instruction title field: `abbyInstructionsTitle`
- Source file field: `abbyInstructionsSourceFile`
- Source path field: `abbyInstructionsSourcePath`
- Source URL field: `abbyInstructionsSourceUrl`
- Audience field: `abbyInstructionsAudience`

## Demo Notes

- This file is intentionally placed at the repository root so it is easy to find in GitHub.
- Do not put real patient information or private credentials in this file.
