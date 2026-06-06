// scripts/generate-auth-template.ts
import { writeFileSync } from "fs"

const template = {
  defaultProvider: "openai",
  providers: {
    openai: {
      apiKey: "YOUR_OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      organization: "YOUR_ORG_ID (optional)"
    },
    anthropic: {
      apiKey: "YOUR_ANTHROPIC_API_KEY",
      baseUrl: "https://api.anthropic.com/v1"
    }
  }
}

writeFileSync("auth.example.json", JSON.stringify(template, null, 2))
console.log("✅ Created auth.example.json")