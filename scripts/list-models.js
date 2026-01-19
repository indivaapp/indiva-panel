// List available Gemini models
const API_KEY = 'AIzaSyBb3aYRtZdH3ttCS19zu7XnFcu4fKSypyk';

async function listModels() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();

        if (data.error) {
            console.log('Error:', data.error.message);
            return;
        }

        console.log('Available models:');
        data.models?.forEach(m => {
            if (m.name.includes('gemini')) {
                console.log(`- ${m.name} (${m.supportedGenerationMethods?.join(', ')})`);
            }
        });
    } catch (err) {
        console.error('Error:', err.message);
    }
}

listModels();
