async function check() {
  const res = await fetch('https://api.github.com/repos/indivaapp/indiva-panel/actions/runs', {
    headers: { 'User-Agent': 'Node.js' }
  });
  const data = await res.json();
  if (data.workflow_runs) {
    const runs = data.workflow_runs.slice(0, 10);
    runs.forEach(r => {
      console.log(`[${r.name}] Status: ${r.status}, Conclusion: ${r.conclusion}, Date: ${r.created_at}`);
    });
  } else {
    console.log(data);
  }
}
check();
