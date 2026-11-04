$body = @{
    days = 30
    minScore = 7
    sendToSlack = $false
} | ConvertTo-Json

$response = Invoke-WebRequest `
    -Uri 'http://localhost:3000/llm/analyze-watchlist' `
    -Method POST `
    -Headers @{'Content-Type'='application/json'} `
    -Body $body

Write-Output $response.Content
