const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyDYKa1bv1uEPHWuT9d2sUIIXZ3Cgz8i2GQ");

async function run() {
    try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + "AIzaSyDYKa1bv1uEPHWuT9d2sUIIXZ3Cgz8i2GQ");
        const data = await response.json();
        const models = data.models.map(m => m.name);
        require('fs').writeFileSync('models.json', JSON.stringify(models, null, 2));
        console.log("Saved to models.json");
    } catch (e) {
        console.error(e);
    }
}
run();
