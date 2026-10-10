// Vercel serverless function: keep the Hugging Face token server-side only.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST to generate an image." });
  }
  if (!process.env.HF_TOKEN) {
    return res.status(503).json({
      error: "AI image generation is not configured yet. Add HF_TOKEN to the Vercel project's Environment Variables, then redeploy."
    });
  }
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ error: "Please enter an image prompt." });
    if (prompt.length > 500) return res.status(400).json({ error: "Prompt must be 500 characters or fewer." });

    const upstream = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "image/*"
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { width: 768, height: 768, num_inference_steps: 4 }
        })
      }
    );

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 700);
      console.error("Hugging Face image generation failed:", upstream.status, detail);
      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(502).json({ error: "The AI provider rejected the token. Check that HF_TOKEN is valid and has Inference Providers permission." });
      }
      if (upstream.status === 429) {
        return res.status(429).json({ error: "The AI provider is busy or the free allowance is exhausted. Try again later or check your provider account." });
      }
      return res.status(502).json({ error: "The AI provider could not generate an image. Check the HF token, model availability, and provider allowance." });
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
      return res.status(502).json({ error: "The AI provider returned a non-image response. Check the selected model and provider access." });
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(bytes.length));
    return res.status(200).send(bytes);
  } catch (error) {
    console.error("Image generation endpoint error:", error);
    return res.status(500).json({ error: "Unexpected image-generation error. Please try again." });
  }
}
