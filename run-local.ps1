$env:PATH = "C:\Users\a\AppData\Roaming\pear\bin;" + $env:PATH
$env:SC_BRIDGE_TOKEN = "MY_TOKEN"

Write-Host "🚀 Starting Intercom Bridge..." -ForegroundColor Cyan
# Using a common Hypercore DHT bootstrap as fallback if needed
$dht = "bootstrap1.hyperdht.org:49737,bootstrap2.hyperdht.org:49737"

Start-Process -NoNewWindow -FilePath "pear" -ArgumentList "run", ".", "--sc-bridge", "1", "--sc-bridge-token", "MY_TOKEN", "--sidechannels", "goals", "--peer-dht-bootstrap", $dht

Write-Host "🤖 Starting AI Agent..." -ForegroundColor Green
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "goal-tracker-agent.cjs"

Write-Host "🌐 Starting UI Dashboard..." -ForegroundColor Yellow
npm run ui
