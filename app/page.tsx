'use client'

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Download, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

interface SearchResult {
  title: string
  url: string
  snippet: string
  score: number
}

interface ErrorResponse {
  error: string
  details?: string
}

const ITEMS_PER_PAGE = 10

export default function ChatInterface() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<ErrorResponse | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    setCurrentPage(1)
    
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(JSON.stringify(data))
      }
      
      setResults(data.results)
    } catch (error) {
      console.error('Search failed:', error)
      let errorResponse: ErrorResponse
      try {
        errorResponse = JSON.parse(error instanceof Error ? error.message : String(error))
      } catch {
        errorResponse = { error: 'Failed to perform search. Please try again.' }
      }
      setError(errorResponse)
      setResults(null)
    } finally {
      setIsLoading(false)
    }
  }

  const exportResults = () => {
    if (!results) return

    const csv = [
      ['Title', 'URL', 'Snippet', 'Score'],
      ...results.map(result => [
        result.title,
        result.url,
        result.snippet,
        result.score
      ])
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'exa-results.csv'
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const totalPages = results ? Math.ceil(results.length / ITEMS_PER_PAGE) : 0
  const paginatedResults = results ? results.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  ) : []

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-3xl font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                NexSearch
              </h1>
            </div>
            {results && results.length > 0 && (
              <Button 
                onClick={exportResults} 
                variant="outline" 
                size="sm"
                className="hover:bg-blue-50 transition-colors"
              >
                <Download className="h-4 w-4 mr-2 text-blue-600" />
                Export Results
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 py-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <form onSubmit={handleSearch} className="w-full max-w-4xl mx-auto mb-8">
          <div className="flex gap-3 items-center w-full">
            <div className="flex-1 min-w-[500px]">
              <Input
                type="text"
                placeholder="Enter your search query..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-white shadow-sm border-slate-200 focus-visible:ring-blue-500 text-base h-11"
              />
            </div>
            <Button 
              type="submit" 
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm px-6 text-base h-11 min-w-[120px]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : (
                'Search'
              )}
            </Button>
          </div>
        </form>

        {error && (
          <div className="max-w-4xl mx-auto mb-8 p-4 text-red-500 bg-red-50 rounded-lg border border-red-200">
            <p className="font-bold">{error.error}</p>
            {error.details && (
              <p className="mt-2 text-sm">{error.details}</p>
            )}
          </div>
        )}

        {results && results.length > 0 && (
          <>
            <div className="w-full mx-auto">
              <div className="rounded-lg border bg-white mb-6 overflow-hidden shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-800 hover:bg-slate-800">
                      <TableHead className="font-medium text-white h-12 w-[35%]">
                        Title
                      </TableHead>
                      <TableHead className="font-medium text-white w-[35%]">
                        URL
                      </TableHead>
                      <TableHead className="font-medium text-white w-[15%]">
                        Snippet
                      </TableHead>
                      <TableHead className="font-medium text-white text-right w-[15%]">
                        Score
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedResults.map((result, index) => (
                      <TableRow 
                        key={index}
                        className="hover:bg-blue-50/50 transition-colors"
                      >
                        <TableCell className="font-medium py-4 pr-4">
                          <div className="break-words">
                            {result.title}
                          </div>
                        </TableCell>
                        <TableCell className="py-4 pr-4">
                          <a 
                            href={result.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline break-words block transition-colors"
                          >
                            {result.url}
                          </a>
                        </TableCell>
                        <TableCell className="py-4 pr-4">
                          <p className="text-slate-600 break-words">
                            {result.snippet}
                          </p>
                        </TableCell>
                        <TableCell className="text-right font-medium text-slate-900 py-4">
                          {result.score.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between items-center px-2 mb-8">
                <p className="text-sm text-slate-600">
                  Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, results.length)} of {results.length} results
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    variant="outline"
                    size="sm"
                    className="hover:bg-blue-50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    variant="outline"
                    size="sm"
                    className="hover:bg-blue-50 transition-colors"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}

        {results && results.length === 0 && (
          <div className="max-w-2xl mx-auto text-center text-gray-500">
            No results found for your search query.
          </div>
        )}
      </main>
    </div>
  )
}

