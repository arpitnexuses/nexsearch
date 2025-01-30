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

interface ContactPerson {
  name: string
  title: string
  email: string
  linkedinUrl: string
  confidence: 'high' | 'medium' | 'low'
  verificationSource: string
}

interface CompanyResult {
  companyName: string;
  domain: string;
  status: 'verified' | 'not_found';
  source: string;
  geography?: string;
  revenue?: string;
  employees?: string;
  linkedinUrl?: string;
}

interface GeneralResponse {
  type: 'general';
  text: string;
  source: string;
}

interface CompanyResponse {
  type: 'companies';
  results: CompanyResult[];
  totalCompanies: number;
  processedCompanies: number;
}

type SearchResponse = GeneralResponse | CompanyResponse;

interface ErrorResponse {
  error: string
  details?: string
}

const ITEMS_PER_PAGE = 10

export default function ChatInterface() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CompanyResult[]>([])
  const [personResults, setPersonResults] = useState<ContactPerson[]>([])
  const [generalResponse, setGeneralResponse] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<ErrorResponse | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [activeTab, setActiveTab] = useState<'company' | 'contacts'>('company')

  const handleSearch = async () => {
    if (!query.trim()) return
    
    setIsLoading(true)
    setError(null)
    setResults([])
    setPersonResults([])
    setGeneralResponse(null)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() })
      })

      if (!response.ok) {
        throw new Error('Search failed')
      }

      const data = await response.json() as SearchResponse
      
      if (data.type === 'general') {
        setGeneralResponse(data.text)
      } else {
        setResults(data.results)
      }
    } catch (err) {
      setError({ error: err instanceof Error ? err.message : 'An error occurred' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const exportResults = () => {
    if (results.length === 0) return

    const csvContent = [
      ['Company Name', 'Domain', 'Source'].join(','),
      ...results.map(result => [
        result.companyName,
        result.domain,
        result.source
      ].join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'company_results.csv'
    link.click()
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
                Company Domain Finder
              </h1>
              <p className="text-sm text-slate-500 ml-4">
                Find domains for any company worldwide
              </p>
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
        <form onSubmit={(e) => { e.preventDefault(); handleSearch() }} className="w-full max-w-4xl mx-auto mb-8">
          <div className="flex gap-3 items-start w-full">
            <div className="flex-1 min-w-[500px]">
              <textarea
                placeholder="Enter your query (e.g., 'Top 10 tech companies in India', 'What are the biggest e-commerce companies in Europe?')"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full bg-white shadow-sm border-slate-200 focus-visible:ring-blue-500 text-base h-32 rounded-md p-3"
              />
              <p className="mt-2 text-sm text-slate-500">
                Ask about any companies worldwide - search by industry, region, size, or type. Get verified domains for top companies, startups, or specific businesses you&apos;re interested in.
              </p>
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

        {generalResponse ? (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6 max-w-4xl mx-auto border border-gray-100">
            <div className="prose prose-sm max-w-none">
              {generalResponse.split('\n\n').map((section, index) => (
                <p key={index} className="mb-4">{section}</p>
              ))}
            </div>
          </div>
        ) : results.length > 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    <TableHead className="font-medium text-white h-12 w-[20%]">Company Name</TableHead>
                    <TableHead className="font-medium text-white w-[15%]">Domain</TableHead>
                    <TableHead className="font-medium text-white w-[15%]">Geography</TableHead>
                    <TableHead className="font-medium text-white w-[15%]">Revenue</TableHead>
                    <TableHead className="font-medium text-white w-[15%]">Company Size</TableHead>
                    <TableHead className="font-medium text-white w-[15%]">LinkedIn</TableHead>
                    <TableHead className="font-medium text-white text-right w-[5%]">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedResults.map((result, index) => (
                    <TableRow 
                      key={`company-${index}`}
                      className="hover:bg-blue-50/50 transition-colors"
                    >
                      <TableCell className="font-medium py-4 pr-4">
                        <div className="break-words">
                          {result.companyName}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 pr-4">
                        {result.status === 'verified' ? (
                          <a 
                            href={`https://${result.domain}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline break-words block transition-colors"
                          >
                            {result.domain}
                          </a>
                        ) : (
                          <span className="text-red-500">Not found</span>
                        )}
                      </TableCell>
                      <TableCell className="py-4 pr-4">
                        <div className="text-sm text-slate-700">
                          {result.geography || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 pr-4">
                        <div className="text-sm text-slate-700">
                          {result.revenue || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 pr-4">
                        <div className="text-sm text-slate-700">
                          {result.employees || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 pr-4">
                        {result.linkedinUrl ? (
                          <a 
                            href={result.linkedinUrl.startsWith('http') ? result.linkedinUrl : `https://${result.linkedinUrl}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline break-words block transition-colors text-sm"
                          >
                            {result.linkedinUrl.replace(/^https?:\/\/(www\.)?/, '')}
                          </a>
                        ) : (
                          <span className="text-sm text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium text-slate-900 py-4">
                        {result.source}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
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
            )}
          </div>
        ) : null}

        {/* {results && results.length === 0 && (
          <div className="max-w-2xl mx-auto text-center text-gray-500">
            No results found for your search query.
          </div>
        )} */}
      </main>
    </div>
  )
}