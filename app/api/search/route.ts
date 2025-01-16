import { NextResponse } from 'next/server'

interface SearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  score?: number;
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json()
    
    if (!process.env.EXA_API_KEY) {
      console.error('EXA_API_KEY is not set')
      return NextResponse.json({ error: 'API key is not configured' }, { status: 500 })
    }

    console.log('Sending request to Exa API with query:', query)
    
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXA_API_KEY,
      },
      body: JSON.stringify({ 
        query,
        numResults: 50, // Request 50 results
      }),
    })
    
    if (!response.ok) {
      console.error('Exa API responded with status:', response.status)
      const errorText = await response.text()
      console.error('Exa API error response:', errorText)
      return NextResponse.json({ 
        error: 'Exa API request failed', 
        details: `Status: ${response.status}, Response: ${errorText}`
      }, { status: response.status })
    }

    const data = await response.json()
    console.log('Received response from Exa API:', JSON.stringify(data, null, 2))
    
    if (!data.results || !Array.isArray(data.results)) {
      console.error('Unexpected response structure from Exa API')
      return NextResponse.json({ 
        error: 'Unexpected API response structure',
        details: JSON.stringify(data)
      }, { status: 500 })
    }

    const results = data.results.map((result: SearchResult) => ({
      title: result.title || 'No title',
      url: result.url || '#',
      snippet: result.snippet || 'No snippet available',
      score: result.score || 0,
    }))
    
    return NextResponse.json({ results })
  } catch (error) {
    console.error('Search API error:', error)
    return NextResponse.json({ 
      error: 'An unexpected error occurred', 
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

