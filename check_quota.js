const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyDYKa1bv1uEPHWuT9d2sUIIXZ3Cgz8i2GQ");

async function testModel(modelName) {
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello!");
        console.log(`[SUCCESS] ${modelName}:`, result.response.text());
        return true;
    } catch (e) {
        console.log(`[FAILED]  ${modelName}:`, e.message.split('\n')[0].substring(0, 100));
        return false;
    }
}

async function run() {
    const modelsToTest = [
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-flash-latest"
    ];
    for (const model of modelsToTest) {
        const works = await testModel(model);
        if (works) {
            break;
        }
    }
}
run();
