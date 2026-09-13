# Spark Stack Academy Backend

Backend API for the sensitive SSA services:

- Spark AI / Groq
- Paystack payments and webhooks
- Firebase Admin verification

The main SSA frontend, authentication, Firestore data, courses, chat, and other application features remain on Firebase.

## Architecture

SSA frontend → this backend → Groq / Paystack / Firebase Admin

## Security

Secrets are supplied through environment variables and must never be committed to GitHub.

Required secrets are documented in `.env.example`.
