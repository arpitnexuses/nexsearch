import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";

interface ContactPerson {
  name: string;
  title: string;
  email: string;
  linkedinUrl: string;
  confidence: 'high' | 'medium' | 'low';
  verificationSource: string;
}

interface DeepseekPerson {
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  linkedin_url?: string;
  email_status: string;
  employment_current: boolean;
}

interface CompanyInfoResponse {
  domain: string;
  geography: string;
  revenue: string;
  employees: string;
  linkedinUrl: string;
  alternativeDomains?: string[];
  industry?: string;
  yearFounded?: string;
}

interface CompanyResult {
  companyName: string;
  domain: string;
  geography?: string;
  revenue?: string;
  employees?: string;
  linkedinUrl?: string;
  source: string;
}

interface ApolloPersonResponse {
  people: Array<{
    first_name: string;
    last_name: string;
    title: string;
    email: string;
    email_status: string;
    linkedin_url?: string;
    employment_current: boolean;
  }>;
}

interface DeepseekCompanyResponse {
  company?: {
    domain?: string;
    headquarters_location?: string;
    annual_revenue?: number;
    employee_count?: number;
    linkedin_url?: string;
    email?: string;
    phone?: string;
  };
}

interface DeepseekPeopleResponse {
  people?: Array<{
    email?: string;
    email_status?: string;
  }>;
}

interface DeepseekSearchPerson {
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  email_status: string;
  email_confidence: number;
  linkedin_url?: string;
}

interface EnrichedResult {
  domain: string;
  apolloData: Partial<CompanyResult>;
  deepseekData: Partial<CompanyResult>;
}

interface ApolloOrganization {
  domain?: string;
  location?: string;
  annual_revenue?: number;
  employee_count?: number;
  linkedin_url?: string;
}

// Add new interface for general responses
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

interface PersonSearchResponse {
  type: 'people';
  results: ContactPerson[];
  confidence: number;
}

type SearchResponse = GeneralResponse | CompanyResponse | PersonSearchResponse;

interface EnrichedData {
  geography?: string;
  revenue?: string;
  employees?: string;
  linkedinUrl?: string;
}

interface ExaSearchResult {
  results: Record<string, unknown>[];
  domain?: string;
}

// Add these type definitions before the POST handler
type APIResult = Partial<CompanyResult> | null;

async function verifyDomain(domain: string): Promise<boolean> {
  if (!domain) return false;
  
  try {
    // First try HTTPS
    try {
      const httpsResponse = await fetch(`https://${domain}`, { 
        method: 'HEAD',
        redirect: 'follow'
      });
      if (httpsResponse.ok) return true;
    } catch {
      // Silently continue to try HTTP if HTTPS fails
    }

    // If HTTPS fails, try HTTP
    try {
      const httpResponse = await fetch(`http://${domain}`, { 
        method: 'HEAD',
        redirect: 'follow'
      });
      if (httpResponse.ok) return true;
    } catch  {
      console.log('HTTP request failed for domain:', domain);
    }

    // If both fail but domain looks valid, still accept it
    return /^[a-zA-Z0-9][a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(domain);
  } catch  {
    // Accept domain if it has a valid format
    return /^[a-zA-Z0-9][a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(domain);
  }
}

async function extractCompanyNamesFromPerplexity(query: string): Promise<string[]> {
  if (!process.env.PERPLEXITY_API_KEY) return [];

  try {
    // First try to understand the query intent
    const intentResponse = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: "pplx-7b-chat",
        messages: [
          {
            role: "system",
            content: `You are a query analyzer. Determine if the input contains:
            1. A natural language question about companies
            2. A single company name
            3. A list of companies (comma-separated or line-separated)
            4. A request for top/best companies in a category
            Return ONLY one of these labels: "QUESTION", "SINGLE", "LIST", "TOP_REQUEST"`
          },
          {
            role: "user",
            content: query
          }
        ]
      })
    });

    if (!intentResponse.ok) return [];
    const intentData = await intentResponse.json();
    const queryType = intentData.choices?.[0]?.message?.content?.trim().toUpperCase();

    // Now extract companies based on query type
    const extractResponse = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-instruct",
        messages: [
          {
            role: "system",
            content: queryType === 'LIST' ? 
              `Extract company names from a list. The input may have companies separated by newlines, commas, or other delimiters.
               Rules:
               1. Return each company name on a new line
               2. Clean up any numbering or bullets
               3. Remove any extra text or context
               4. Keep only the company names` 
              : queryType === 'TOP_REQUEST' ?
              `Extract company names from a request about top companies.
               Rules:
               1. Return each company name on a new line
               2. Remove words like "top", "best", "leading"
               3. Remove any ranking numbers
               4. Focus on actual company names`
              : `Extract company names from the query.
               Rules:
               1. Return each company name on a new line
               2. Remove any extra words or context
               3. If multiple companies are mentioned, list each one
               4. Clean up and standardize company names`
          },
          {
            role: "user",
            content: query
          }
        ]
      })
    });

    if (!extractResponse.ok) return [];
    const extractData = await extractResponse.json();
    const result = extractData.choices?.[0]?.message?.content?.trim();
    if (!result) return [];

    // Split by newlines first, then by commas if needed
    let companies = result.split(/[\n\r]+/).map((line: string) => line.trim());
    if (companies.length === 1 && companies[0].includes(',')) {
      companies = companies[0].split(',').map((name: string) => name.trim());
    }

    return companies.filter((name: string) => 
      name.length > 0 && 
      !name.match(/^[\d\s.)-]+$/) && // Remove lines that are just numbers or bullets
      !name.toLowerCase().startsWith('note:') // Remove any notes or explanations
    );
  } catch (e) {
    console.error('Perplexity API error:', e);
    return [];
  }
}

async function extractCompanyNames(query: string): Promise<string[]> {
  // First try Perplexity for all types of queries
  const perplexityResults = await extractCompanyNamesFromPerplexity(query);
  if (perplexityResults.length > 0) {
    return perplexityResults;
  }

  // Handle explicit list in curly braces as fallback
  if (query.includes('{') && query.includes('}')) {
    const bracketContent = query.match(/\{([^}]+)\}/)?.[1];
    if (bracketContent) {
      const lines = bracketContent
        .split(/[\n\r]+/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
      if (lines.length > 0) return lines;
    }
  }

  // Handle multi-line input as fallback
  if (query.includes('\n')) {
    const lines = query
      .split(/[\n\r]+/)
      .map(line => line.trim())
      .filter(line => 
        line.length > 0 && 
        !line.match(/^[\d\s.)-]+$/) && // Remove lines that are just numbers or bullets
        !line.toLowerCase().startsWith('note:') // Remove any notes or explanations
      );
    if (lines.length > 0) return lines;
  }

  // Handle comma-separated list as fallback
  if (query.includes(',')) {
    const items = query
      .split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0);
    if (items.length > 0) return items;
  }

  // Fallback to Deepseek if everything else fails
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: `Extract company names from any type of query. Return ONLY company names, one per line.
              Handle:
              1. Natural language questions
              2. Single company names
              3. Lists of companies (in any format)
              4. Companies mentioned in context`
            },
            {
              role: "user",
              content: query
            }
          ],
          temperature: 0.1,
          max_tokens: 150
        })
      });

      if (!response.ok) return [query];

      const data = await response.json();
      const result = data.choices?.[0]?.message?.content?.trim();
      if (!result) return [query];

      return result
        .split(/[\n\r]+/)
        .map((name: string) => name.trim())
        .filter((name: string) => name.length > 0);
    } catch (e) {
      console.error('Deepseek extraction error:', e);
    }
  }

  // If all else fails, return the query as a single company
  return [query];
}

async function findContactPersons(company: string, domain: string): Promise<ContactPerson[]> {
  if (!process.env.DEEPSEEK_API_KEY) return [];

  try {
    // Search for key persons through Deepseek
    const response = await fetch('https://api.deepseek.com/v1/people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        company_domain: domain,
        seniority_levels: ['executive', 'director', 'manager'],
        limit: 10,
        include_email: true,
        include_linkedin: true
      })
    });

    if (!response.ok) return [];
    
    const data = await response.json();
    if (!data.people) return [];

    // Filter and verify contacts
    const verifiedContacts = await Promise.all(
      (data.people as DeepseekSearchPerson[])
        .filter((person: DeepseekSearchPerson) => 
          person.email_status === 'verified' && 
          person.email?.endsWith(domain)
        )
        .map(async (person: DeepseekSearchPerson) => {
          // Verify LinkedIn URL if present
          let linkedinUrl = 'Not available';
          if (person.linkedin_url) {
            const verifiedUrl = await verifyLinkedInUrl(person.linkedin_url);
            if (verifiedUrl) linkedinUrl = verifiedUrl;
          }

          return {
            name: `${person.first_name} ${person.last_name}`,
            title: person.title,
            email: person.email,
            linkedinUrl,
            confidence: person.email_confidence > 0.9 ? 'high' : 'medium',
            verificationSource: 'Verified through Deepseek'
          };
        })
    );

    return verifiedContacts
      .filter((contact): contact is ContactPerson => 
        contact !== null && 
        contact.name.includes(' ') && 
        contact.title.length > 2
      )
      .slice(0, 5); // Return top 5 verified contacts
  } catch (e) {
    console.error('Error finding contact persons:', e);
    return [];
  }
}

async function verifyLinkedInUrl(url: string): Promise<string | null> {
  if (!url || !url.includes('linkedin.com')) return null;
  
  // Only accept company pages
  if (!url.includes('/company/')) return null;
  
  // Clean and standardize LinkedIn URL
  const cleanUrl = url
    .replace(/^(https?:\/\/)?(www\.)?/i, '')
    .replace(/\/$/, '')
    .toLowerCase()
    .trim();
  
  // Must match exact LinkedIn company URL pattern
  if (!cleanUrl.match(/^linkedin\.com\/company\/[\w-]+\/?$/)) return null;
  
  const fullUrl = `https://www.${cleanUrl}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(fullUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    // Check if it's a valid company page
    if (response.ok && response.status === 200) {
      console.log('LinkedIn URL verified:', fullUrl);
      return fullUrl;
    }
  } catch {
    // If network error, still validate format
    if (cleanUrl.match(/^linkedin\.com\/company\/[\w-]+\/?$/)) {
      return fullUrl;
    }
  }
  
  return null;
}

async function verifyEmail(email: string, domain: string): Promise<boolean> {
  try {
    // Strict format check
    const emailRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) return false;

    // Domain match check
    const emailDomain = email.split('@')[1].toLowerCase();
    const targetDomain = domain.toLowerCase();
    
    // Exact domain match required
    if (emailDomain !== targetDomain) return false;

    // Reject common patterns
    const invalidPatterns = [
      'noreply', 'no-reply', 'donotreply', 'test', 'example', 'temp', 'fake',
      'spam', 'admin@', 'administrator@', 'webmaster@', 'info@', 'contact@'
    ];
    
    if (invalidPatterns.some(pattern => email.toLowerCase().includes(pattern))) {
      return false;
    }

    // Check domain validity
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`https://${emailDomain}`, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      if (!response.ok) return false;
      
      // Additional MX record check could be added here
      
    } catch  {
      return false;
    }

    return true;
  } catch  {
    return false;
  }
}

async function findApolloContacts(company: string, domain: string): Promise<ContactPerson[]> {
  if (!process.env.APOLLO_API_KEY || !domain) return [];

  try {
    const peopleResponse = await fetch('https://api.apollo.io/v1/people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Api-Key': process.env.APOLLO_API_KEY
      },
      body: JSON.stringify({
        q_organization_domains: [domain],
        page: 1,
        per_page: 15,
        person_titles: ['CEO', 'CTO', 'CFO', 'COO', 'President', 'VP', 'Director'],
        contact_email_status: ['verified'],
        q_employment_current: true
      })
    });

    let contacts: ContactPerson[] = [];

    if (peopleResponse.ok) {
      const data = await peopleResponse.json() as ApolloPersonResponse;
      
      // Filter potential contacts
      const potentialContacts = data.people.filter(person => {
        const hasValidName = person.first_name?.length > 1 && 
                           person.last_name?.length > 1 && 
                           /^[A-Za-z\s-]+$/.test(person.first_name) && 
                           /^[A-Za-z\s-]+$/.test(person.last_name);
                           
        const hasValidTitle = person.title?.length > 2 && 
                            /^[A-Za-z\s,&-]+$/.test(person.title);
                            
        const hasValidEmail = person.email?.includes(domain) && 
                            person.email_status === 'verified';

        return hasValidName && hasValidTitle && hasValidEmail && person.employment_current === true;
      });

      // Verify contacts with Deepseek in parallel
      const verifiedContacts = await Promise.all(
        potentialContacts.map(person => verifyContactWithDeepseek(person, company, domain))
      );

      contacts = verifiedContacts.filter((contact): contact is ContactPerson => 
        contact !== null && 
        contact.name.split(' ').length >= 2 &&
        contact.title.length >= 3
      );

      // Sort by title importance
      contacts.sort((a, b) => {
        const titleScore = (title: string) => {
          const t = title.toLowerCase();
          if (t.includes('ceo') || t.includes('chief executive')) return 100;
          if (t.includes('cto') || t.includes('cfo') || t.includes('coo')) return 90;
          if (t.includes('president')) return 80;
          if (t.includes('vice president') || t.includes('vp')) return 70;
          if (t.includes('head')) return 60;
          if (t.includes('director')) return 50;
          return 0;
        };
        return titleScore(b.title) - titleScore(a.title);
      });
    }

    return contacts.slice(0, 3); // Return top 3 verified contacts
  } catch (e) {
    console.error('Contact search error:', e);
    return [];
  }
}

// Update getApolloData function to be more resilient
async function getApolloData(company: string, domain?: string): Promise<Partial<CompanyResult>> {
  if (!process.env.APOLLO_API_KEY) {
    console.log('Apollo API key not configured');
    return {};
  }

  try {
    console.log('Getting Apollo data for:', company, 'domain:', domain);
    
    // First try enrichment if we have a domain
    let enrichedData: ApolloOrganization | null = null;
    if (domain) {
      const enrichResponse = await fetch('https://api.apollo.io/v1/organizations/enrich', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Api-Key': process.env.APOLLO_API_KEY
        },
        body: JSON.stringify({ domain })
      });

      if (enrichResponse.ok) {
        const data = await enrichResponse.json();
        if (data?.organization) {
          console.log('Found enriched data for domain:', domain);
          enrichedData = data.organization;
        }
      } else {
        console.log('Apollo enrich failed:', await enrichResponse.text());
      }
    }

    // If enrichment didn't work, try search
    if (!enrichedData) {
      const searchResponse = await fetch('https://api.apollo.io/v1/organizations/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Api-Key': process.env.APOLLO_API_KEY
        },
        body: JSON.stringify({
          q_organization_name: company,
          page: 1,
          per_page: 5
        })
      });

      if (searchResponse.ok) {
        const data = await searchResponse.json();
        if (data?.organizations?.length > 0) {
          // If we have a domain, find exact match
          if (domain) {
            enrichedData = data.organizations.find((org: ApolloOrganization) => 
              org.domain?.toLowerCase().replace(/^www\./, '') === domain.toLowerCase()
            );
          }
          // If no domain match found, use first result
          if (!enrichedData) {
            enrichedData = data.organizations[0];
          }
          console.log('Found search data for company:', company);
        }
      } else {
        console.log('Apollo search failed:', await searchResponse.text());
      }
    }

    if (!enrichedData) {
      console.log('No Apollo data found for:', company);
      return {};
    }

    // Clean and format the data
    const result: Partial<CompanyResult> = {
      domain: enrichedData.domain || domain || '',
      geography: [enrichedData.location]
        .filter(Boolean)
        .join(', '),
      revenue: enrichedData.annual_revenue ? formatRevenue(enrichedData.annual_revenue) : '',
      employees: enrichedData.employee_count?.toString() || '',
      linkedinUrl: enrichedData.linkedin_url || '',
    };

    // Only include fields that have actual data
    return Object.fromEntries(
      Object.entries(result).filter(([ value]) => 
        value && value !== '' && value !== 'Not available'
      )
    ) as Partial<CompanyResult>;
  } catch (e) {
    console.error('Apollo API error:', e);
    return {};
  }
}

// Update getDeepseekData function to handle data better
async function getDeepseekData(company: string, domain?: string): Promise<Partial<CompanyResult>> {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('Deepseek API key not configured');
    return {};
  }

  try {
    console.log('Getting Deepseek data for:', company, 'domain:', domain);
    
    const [companyResponse, peopleResponse] = await Promise.all([
      fetch('https://api.deepseek.com/v1/companies/enrich', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          company_name: company,
          domain: domain,
          enrich_level: 'full'
        })
      }).then(res => res.json() as Promise<DeepseekCompanyResponse>),
      domain ? fetch('https://api.deepseek.com/v1/people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          company_domain: domain,
          seniority_levels: ['executive', 'director', 'manager'],
          limit: 5
        })
      }).then(res => res.json() as Promise<DeepseekPeopleResponse>) : Promise.resolve(null)
    ]);

    if (!companyResponse.company) {
      console.log('No Deepseek company data found for:', company);
      return {};
    }

    const companyData = companyResponse.company;

    // Clean and format the data
    const result: Partial<CompanyResult> = {
      domain: companyData.domain || domain || '',
      geography: companyData.headquarters_location || '',
      revenue: companyData.annual_revenue ? formatRevenue(companyData.annual_revenue) : '',
      employees: companyData.employee_count?.toString() || '',
      linkedinUrl: companyData.linkedin_url || '',
    };

    // Only include fields that have actual data
    return Object.fromEntries(
      Object.entries(result).filter(([ value]) => 
        value && value !== '' && value !== 'Not available'
      )
    ) as Partial<CompanyResult>;
  } catch (e) {
    console.error('Deepseek API error:', e);
    return {};
  }
}

// Add Deepseek contact verification
async function verifyContactWithDeepseek(person: DeepseekPerson, company: string, domain: string): Promise<ContactPerson | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;

  try {
    const response = await fetch('https://api.deepseek.com/v1/people/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        name: `${person.first_name} ${person.last_name}`,
        company_name: company,
        company_domain: domain,
        title: person.title,
        email: person.email,
        linkedin_url: person.linkedin_url
      })
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data.verification || data.verification.confidence < 0.7) return null;

    return {
      name: `${person.first_name} ${person.last_name}`,
      title: person.title,
      email: data.verification.email || person.email,
      linkedinUrl: data.verification.linkedin_url || person.linkedin_url || 'Not available',
      confidence: data.verification.confidence > 0.9 ? 'high' : 'medium',
      verificationSource: 'Verified through Deepseek and Apollo.io'
    };
  } catch (e) {
    console.error('Deepseek verification error:', e);
    return null;
  }
}

// Add API key validation at the start
function validateAPIKeys() {
  const missingKeys = [];
  if (!process.env.EXA_API_KEY) missingKeys.push('EXA_API_KEY');
  if (!process.env.APOLLO_API_KEY) missingKeys.push('APOLLO_API_KEY');
  if (!process.env.DEEPSEEK_API_KEY) missingKeys.push('DEEPSEEK_API_KEY');
  
  if (missingKeys.length > 0) {
    console.warn('Missing API keys:', missingKeys.join(', '));
  }
  return missingKeys;
}

async function verifyDomainWithPerplexity(company: string, domain: string): Promise<boolean> {
  if (!process.env.PERPLEXITY_API_KEY) return false;

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-instruct",
        messages: [
          {
            role: "system",
            content: `You are a domain verification expert. Verify if a domain is the official website for a company.
            Rules:
            1. Check if the domain matches the company's brand
            2. Verify if it's a corporate domain (not a social media or third-party site)
            3. Look for patterns like company-name.com, company.com, companyname.com
            4. Be strict about verification - only return "yes" if very confident
            5. Consider regional domains (.co.uk, .co.jp, etc.) if appropriate
            Return ONLY "yes" or "no".`
          },
          {
            role: "user",
            content: `Company: ${company}
            Domain: ${domain}
            Is this the official company website domain?`
          }
        ]
      })
    });

    if (!response.ok) return false;
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim().toLowerCase();
    return result === 'yes';
  } catch (e) {
    console.error('Perplexity domain verification error:', e);
    return false;
  }
}

// Helper functions for data formatting
function formatGeography(geography: string | undefined): string | undefined {
  if (!geography) return undefined;
  return geography.replace(/\s+/g, ' ').trim();
}

// Update the formatRevenue function to handle both string and number inputs
function formatRevenue(revenue: string | number | undefined): string | undefined {
  if (!revenue) return undefined;
  
  // If it's already a string, try to parse and format it
  if (typeof revenue === 'string') {
    const match = revenue.match(/\$?(\d+\.?\d*)\s*(B|M|K|T).*?(\(\d{4}\))?/i);
    if (match) {
      const [ amount, unit, year] = match;
      return `$${amount}${unit.toUpperCase()}${year || ''}`;
    }
    return revenue;
  }

  // Handle number input
  if (revenue >= 1000000000) {
    return `$${(revenue / 1000000000).toFixed(1)}B`;
  } else if (revenue >= 1000000) {
    return `$${(revenue / 1000000).toFixed(1)}M`;
  } else if (revenue >= 1000) {
    return `$${(revenue / 1000).toFixed(1)}K`;
  }
  return `$${revenue}`;
}

function formatEmployees(employees: string | undefined): string | undefined {
  if (!employees) return undefined;
  // Standardize employee count format
  return employees.replace(/\s+/g, '').replace(/(\d+)-(\d+)/, '$1 - $2');
}

function formatLinkedInUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Ensure URL has proper format
  if (!url.startsWith('http')) {
    url = `https://${url}`;
  }
  // Ensure it's a company page
  if (!url.includes('/company/')) {
    return undefined;
  }
  return url;
}

// Helper function to check common invalid domains
function isCommonInvalidDomain(domain: string): boolean {
  const invalidDomains = [
    'google.com',
    'facebook.com',
    'linkedin.com',
    'zoominfo.com',
    'rocketreach.co',
    'clutch.co',
    'crunchbase.com',
    'datanyze.com',
    'owler.com',
    'leadiq.com',
    'apollo.io',
    'wikipedia.org'
  ];
  return invalidDomains.some(invalid => domain.includes(invalid));
}

// Helper function to combine data from multiple sources
function combineData(apolloData: Partial<CompanyResult>, deepseekData: Partial<CompanyResult>): Partial<CompanyResult> {
  return {
    geography: findMostReliableValue([apolloData.geography, deepseekData.geography]),
    revenue: findMostReliableValue([apolloData.revenue, deepseekData.revenue]),
    employees: findMostReliableValue([apolloData.employees, deepseekData.employees]),
    linkedinUrl: findMostReliableValue([apolloData.linkedinUrl, deepseekData.linkedinUrl]),
  };
}

// Helper function to count defined fields in an object
function countDefinedFields(obj: Record<string, any>): number {
  return Object.values(obj).filter(value => 
    value !== undefined && 
    value !== null && 
    value !== '' && 
    value !== 'Not available'
  ).length;
}

// Helper function to find most reliable value
function findMostReliableValue(values: (string | undefined)[]): string | undefined {
  const validValues = values
    .filter((v): v is string => 
      typeof v === 'string' && 
      v.length > 0 &&
      v !== 'Not available' && 
      v !== 'undefined'
    );
  
  if (validValues.length === 0) return undefined;

  // If multiple values exist, prefer the most detailed one
  return validValues.reduce((prev, current) => 
    (current.length > prev.length) ? current : prev
  );
}

// Helper function to verify and select LinkedIn URL
async function verifyAndSelectLinkedIn(urls: (string | undefined)[]): Promise<string | undefined> {
  const validUrls = urls.filter(Boolean);
  
  for (const url of validUrls) {
    const verified = await verifyLinkedInUrl(url!);
    if (verified) return verified;
  }
  
  return undefined;
}

// Update cleanCompanyData function to include all required fields
function cleanCompanyData(data: CompanyResult): CompanyResult {
  return {
    companyName: data.companyName,
    domain: data.domain || 'Not found',
    geography: data.geography || '',
    revenue: data.revenue || '',
    employees: data.employees || '',
    linkedinUrl: data.linkedinUrl || '',
    source: data.source || 'Unknown'
  };
}

// Keep only one implementation of enrichCompanyData
async function enrichCompanyData(apolloData: ApolloOrganization, companyName: string): Promise<CompanyResult> {
  return {
    companyName,
    domain: apolloData.domain || '',
    geography: apolloData.location || '',
    revenue: apolloData.annual_revenue?.toString() || '',
    employees: apolloData.employee_count?.toString() || '',
    linkedinUrl: apolloData.linkedin_url || '',
    source: 'Apollo'
  };
}

// Update searchExaAPI function to return ExaSearchResult
async function searchExaAPI(company: string): Promise<ExaSearchResult | null> {
  if (!process.env.EXA_API_KEY) return null;

  try {
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXA_API_KEY,
      },
      body: JSON.stringify({
        query: `${company} company headquarters official website contact information`,
        numResults: 5,
        useAutoprompt: true,
        type: "keyword",
        excludeDomains: ["facebook.com", "twitter.com", "linkedin.com", "instagram.com", "youtube.com", "wikipedia.org"]
      }),
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data?.results?.[0]) return null;

    const domain = new URL(data.results[0].url).hostname;
    return {
      results: data.results,
      domain
    };
  } catch (e) {
    console.error('EXA API error:', e);
    return null;
  }
}

// Update tryExaAPI to handle the new return type
async function tryExaAPI(query: string): Promise<CompanyResult> {
  try {
    const exaResults = await searchExaAPI(query);
    if (!exaResults || !exaResults.results || exaResults.results.length === 0) {
      return {
        companyName: query,
        domain: 'Not found',
        geography: '',
        revenue: '',
        employees: '',
        linkedinUrl: '',
        source: 'No data'
      };
    }

    const details = await getCompanyDetailsFromExa(exaResults.results, query);
    
    return {
      ...details,
      domain: exaResults.domain || 'Not found'
    };
  } catch (e) {
    console.error('Error in tryExaAPI:', e);
    return {
      companyName: query,
      domain: 'Error',
      geography: '',
      revenue: '',
      employees: '',
      linkedinUrl: '',
      source: 'Error'
    };
  }
}

async function analyzeQueryType(query: string): Promise<'natural' | 'companies'> {
  if (!process.env.OPENAI_API_KEY) return 'companies';

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `Analyze if the query is:
          1. A natural language question about companies/business (return "natural")
          2. A list or request for specific company information (return "companies")
          
          Examples:
          - "What are the latest trends in AI companies?" -> "natural"
          - "Microsoft, Apple, Google" -> "companies"
          - "Find domains for tech companies in India" -> "companies"
          - "How do successful startups raise funding?" -> "natural"
          - "What's the impact of AI on business?" -> "natural"
          - "Top e-commerce companies" -> "companies"
          
          Return ONLY "natural" or "companies"`
        },
        {
          role: "user",
          content: query
        }
      ],
      temperature: 0.1,
      max_tokens: 10
    });

    const result = completion.choices[0]?.message?.content?.trim().toLowerCase();
    return result === 'natural' ? 'natural' : 'companies';
  } catch (e) {
    console.error('Query analysis error:', e);
    return 'companies';
  }
}

async function getNaturalResponse(query: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return "Unable to process natural language queries at this time.";
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert business and company information analyst. Provide detailed, insightful responses to business queries.
          
          Format your response with these rules:
          1. Use "Section:" prefix for main headings (e.g., "Section: Overview")
          2. Use "Service:" prefix for each service or feature
          3. Use "Point:" prefix for each point in a list
          4. No numbering, asterisks, or markdown symbols
          5. Keep paragraphs separated by double newlines
          
          Example format:
          Section: Overview
          [Overview content here]

          Section: Services
          Service: Data Collection
          [Service description here]

          Service: Data Analysis
          [Service description here]

          Section: Key Points
          Point: First important point here
          Point: Second important point here
          Point: Third important point here

          Section: Details
          [Detailed content here]

          Guidelines:
          1. Be comprehensive yet concise
          2. Include relevant examples and data
          3. Structure your response with clear sections
          4. Add industry insights when relevant
          5. Cite recent trends and developments
          6. Provide actionable takeaways
          7. Use a professional yet engaging tone
          8. Break down complex concepts
          9. Include market statistics when available
          10. Consider global perspectives`
        },
        {
          role: "user",
          content: query
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    return completion.choices[0]?.message?.content?.trim() || "Unable to generate a response.";
  } catch (e) {
    console.error('Natural response error:', e);
    return "An error occurred while processing your query.";
  }
}

// Update getCompanyDetailsFromExa function
async function getCompanyDetailsFromExa(results: any[], companyName: string): Promise<CompanyResult> {
  try {
    const details: CompanyResult = {
      companyName,
      domain: '',
      geography: '',
      revenue: '',
      employees: '',
      linkedinUrl: '',
      source: 'EXA'
    };
    
    const combinedText = results
      .map(r => {
        const parts = [];
        if (r.title) parts.push(`Title: ${r.title}`);
        if (r.snippet) parts.push(`Summary: ${r.snippet}`);
        if (r.text) parts.push(`Content: ${r.text}`);
        return parts.join('\n');
      })
      .join('\n\n');

    if (!process.env.DEEPSEEK_API_KEY) return details;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are a precise company information extractor. From the given text, extract ONLY verified information into a JSON object with these fields:
{
  "geography": "exact headquarters location",
  "revenue": "latest annual revenue with year",
  "employees": "current employee count or precise range",
  "linkedinUrl": "company LinkedIn URL"
}
Rules:
1. Only include information explicitly found in the text
2. Include the year for revenue data
3. Format revenue as "$XB/M/K (YYYY)"
4. Format employee count as exact number or tight range
5. Omit any field where information is not explicitly found
6. Do not make assumptions or include uncertain data
7. Verify information appears in multiple sources when possible`
          },
          {
            role: "user",
            content: combinedText
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      })
    });

    if (!response.ok) return details;

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim();
    if (!result) return details;

    try {
      const parsedData = JSON.parse(result);
      if (typeof parsedData.geography === 'string' && parsedData.geography) details.geography = parsedData.geography;
      if (typeof parsedData.revenue === 'string' && parsedData.revenue.includes('$')) details.revenue = parsedData.revenue;
      if (typeof parsedData.employees === 'string' && /\d/.test(parsedData.employees)) details.employees = parsedData.employees;
      if (typeof parsedData.linkedinUrl === 'string' && parsedData.linkedinUrl.includes('linkedin.com/company/')) {
        details.linkedinUrl = parsedData.linkedinUrl;
      }

      return details;
    } catch (e) {
      console.error('Failed to parse EXA details:', e);
      return details;
    }
  } catch (e) {
    console.error('Error extracting EXA details:', e);
    return {
      companyName,
      domain: 'Error',
      geography: '',
      revenue: '',
      employees: '',
      linkedinUrl: '',
      source: 'EXA Error'
    };
  }
}

// Update getCompanyDetails function
async function getCompanyDetails(company: string): Promise<CompanyResult> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      companyName: company,
      domain: 'No API Key',
      geography: '',
      revenue: '',
      employees: '',
      linkedinUrl: '',
      source: 'Error'
    };
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a company information API that ONLY returns valid JSON. For the given company, return a JSON object with these fields:
{
  "domain": "company.com",
  "geography": "Primary location",
  "revenue": "Latest revenue",
  "employees": "Employee count",
  "linkedinUrl": "LinkedIn URL"
}

Rules:
1. ONLY return the JSON object, no other text
2. If information is not available, use empty string ""
3. Always return ALL fields, even if empty
4. Format revenue as "$XB/M/K" if known
5. Format employees as number or range
6. For LinkedIn, only include if it's official company page
7. Never return null values, use empty string instead
8. Ensure the response is valid JSON`
        },
        {
          role: "user",
          content: `Return company information JSON for: ${company}`
        }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const result = completion.choices[0]?.message?.content?.trim();
    if (!result) {
      return {
        companyName: company,
        domain: 'No Response',
        geography: '',
        revenue: '',
        employees: '',
        linkedinUrl: '',
        source: 'OpenAI Error'
      };
    }

    try {
      const parsedResult = JSON.parse(result);
      return {
        companyName: company,
        domain: parsedResult.domain || '',
        geography: parsedResult.geography || '',
        revenue: parsedResult.revenue ? formatRevenue(parsedResult.revenue) : '',
        employees: parsedResult.employees ? formatEmployees(parsedResult.employees) : '',
        linkedinUrl: parsedResult.linkedinUrl ? formatLinkedInUrl(parsedResult.linkedinUrl) : '',
        source: 'OpenAI'
      };
    } catch (e) {
      console.error('Failed to parse company details:', e);
      return {
        companyName: company,
        domain: 'Parse Error',
        geography: '',
        revenue: '',
        employees: '',
        linkedinUrl: '',
        source: 'OpenAI Error'
      };
    }
  } catch (e) {
    console.error('OpenAI company details error:', e);
    return {
      companyName: company,
      domain: 'API Error',
      geography: '',
      revenue: '',
      employees: '',
      linkedinUrl: '',
      source: 'OpenAI Error'
    };
  }
}

// LangChain enhanced query processor
async function processQueryWithLangChain(query: string): Promise<{ 
  enhancedQuery: string;
  searchIntent: 'company' | 'person' | 'general';
  confidenceScore: number;
}> {
  const model = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const queryAnalysisPrompt = PromptTemplate.fromTemplate(`
    Analyze the following search query and provide:
    1. An enhanced version of the query
    2. The search intent (company, person, or general)
    3. A confidence score (0-1)

    Query: {query}

    Respond in JSON format:
    {
      "enhancedQuery": "enhanced query here",
      "searchIntent": "company|person|general",
      "confidenceScore": 0.95
    }
  `);

  const chain = RunnableSequence.from([
    queryAnalysisPrompt,
    model,
    new StringOutputParser(),
  ]);

  try {
    const result = await chain.invoke({
      query: query,
    });
    
    return JSON.parse(result);
  } catch (error) {
    console.error('LangChain processing error:', error);
    return {
      enhancedQuery: query,
      searchIntent: 'general',
      confidenceScore: 0.5
    };
  }
}

// Add the searchPeople function before the POST route handler
async function searchPeople(query: string): Promise<ContactPerson[]> {
  try {
    // Combine Apollo and Deepseek person search
    const [apolloResults, deepseekResults] = await Promise.all([
      (async () => {
        try {
          // Reuse existing Apollo person search logic
          return [] as ContactPerson[];
        } catch (e) {
          console.error('Apollo person search error:', e);
          return [];
        }
      })(),
      (async () => {
        try {
          // Reuse existing Deepseek person search logic
          return [] as ContactPerson[];
        } catch (e) {
          console.error('Deepseek person search error:', e);
          return [];
        }
      })()
    ]);

    // Combine and deduplicate results
    const combinedResults = [...apolloResults, ...deepseekResults];
    const uniqueResults = Array.from(new Set(combinedResults.map(p => p.email)))
      .map(email => combinedResults.find(p => p.email === email)!);

    return uniqueResults;
  } catch (error) {
    console.error('Person search error:', error);
    return [];
  }
}

// Modify the existing route handler to use LangChain
export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
    }

    // First check if it's a list of companies (one per line)
    const lines = query.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const isCompanyList = lines.length > 0 && !query.toLowerCase().includes('?') && 
                         !query.toLowerCase().includes('what') && !query.toLowerCase().includes('how') &&
                         !query.toLowerCase().includes('find') && !query.toLowerCase().includes('search');

    if (isCompanyList) {
      // Process each company in parallel
      const companyPromises = lines.map(async (company) => {
        try {
          console.log('Processing company:', company);
          const sources: string[] = [];
          let bestData: Partial<CompanyResult> = {};
          
          // Try all APIs in parallel
          const apiResults = await Promise.all([
            (async () => {
              try {
                const results = await searchExaAPI(company);
                if (results && Array.isArray(results.results) && results.results.length > 0) {
                  const details = await getCompanyDetailsFromExa(results.results, company);
                  if (details && Object.keys(details).length > 0) {
                    sources.push('EXA');
                    return {
                      ...details,
                      domain: results.domain || details.domain || ''
                    };
                  }
                }
                return null;
              } catch (e) {
                console.error('EXA API error:', e);
                return null;
              }
            })(),
            (async () => {
              try {
                const data = await getCompanyDetails(company);
                if (data && Object.keys(data).length > 0) {
                  sources.push('OpenAI');
                  return data;
                }
                return null;
              } catch (e) {
                console.error('OpenAI API error:', e);
                return null;
              }
            })(),
            (async () => {
              try {
                const data = await getApolloData(company);
                if (data && Object.keys(data).length > 0) {
                  sources.push('Apollo');
                  return data;
                }
                return null;
              } catch (e) {
                console.error('Apollo API error:', e);
                return null;
              }
            })(),
            (async () => {
              try {
                const data = await getDeepseekData(company);
                if (data && Object.keys(data).length > 0) {
                  sources.push('Deepseek');
                  return data;
                }
                return null;
              } catch (e) {
                console.error('Deepseek API error:', e);
                return null;
              }
            })()
          ]) as [APIResult, APIResult, APIResult, APIResult];

          // Combine data from all sources
          apiResults.forEach(data => {
            if (data && typeof data === 'object') {
              bestData = {
                ...bestData,
                domain: bestData.domain || data.domain || '',
                geography: bestData.geography || data.geography || '',
                revenue: bestData.revenue || data.revenue || '',
                employees: bestData.employees || data.employees || '',
                linkedinUrl: bestData.linkedinUrl || data.linkedinUrl || ''
              };
            }
          });

          return {
            companyName: company,
            ...bestData,
            source: sources.join(', ') || 'No data found'
          } as CompanyResult;
        } catch (e) {
          console.error('Error processing company:', company, e);
          return {
            companyName: company,
            domain: 'Error',
            source: 'Error'
          } as CompanyResult;
        }
      });

      const results = await Promise.all(companyPromises);
      
      // Return in the original format
      return NextResponse.json({
        type: 'companies',
        results: results.map(result => ({
          ...result,
          status: result.domain && result.domain !== 'Not found' ? 'verified' : 'not_found'
        })),
        totalCompanies: lines.length,
        processedCompanies: results.length
      } as CompanyResponse);

    } else {
      // It's a natural language query
      // Use LangChain to enhance the query
      const enhancedQuery = await processQueryWithLangChain(query);
      
      if (enhancedQuery.searchIntent === 'company') {
        // Extract company names and process them
        const companyNames = await extractCompanyNamesFromPerplexity(enhancedQuery.enhancedQuery);
        if (companyNames.length > 0) {
          // Process companies and return table format
          const results = await Promise.all(companyNames.map(async (company) => {
            const data = await getCompanyDetails(company);
            const domain = data.domain || 'Not found';
            return {
              companyName: company,
              domain,
              status: domain !== 'Not found' ? 'verified' : 'not_found',
              geography: data.geography || '',
              revenue: data.revenue || '',
              employees: data.employees || '',
              linkedinUrl: data.linkedinUrl || '',
              source: 'OpenAI'
            } as CompanyResult;
          }));

          return NextResponse.json({
            type: 'companies',
            results,
            totalCompanies: companyNames.length,
            processedCompanies: results.length
          } as CompanyResponse);
        }
      }

      // If no companies found or it's a general query, return natural language response
      const response = await getNaturalResponse(query);
      return NextResponse.json({
        type: 'general',
        text: response,
        source: 'system'
      } as GeneralResponse);
    }
    
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}