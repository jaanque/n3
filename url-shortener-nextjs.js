// File: package.json
{
  "name": "url-shortener",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "next": "14.0.3",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "nanoid": "^5.0.3",
    "tailwindcss": "^3.3.5",
    "postcss": "^8.4.31",
    "autoprefixer": "^10.4.16",
    "date-fns": "^2.30.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "@types/node": "20.9.4",
    "@types/react": "18.2.38",
    "eslint": "8.54.0",
    "eslint-config-next": "14.0.3",
    "typescript": "5.3.2"
  }
}

// File: .env.local
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
URL_DOMAIN=nam3.es

// File: lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;

// File: lib/utils.js
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

// Generate a random short code (6 characters)
export const generateShortCode = () => {
  return nanoid(6);
};

// Check if a URL is valid
export const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
};

// Hash password for URL protection
export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

// Compare password for URL protection
export const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// Format date for display
export const formatDate = (date) => {
  return new Date(date).toLocaleDateString();
};

// File: pages/api/shorten.js
import supabase from '../../lib/supabase';
import { generateShortCode, isValidUrl, hashPassword } from '../../lib/utils';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url, customCode, expirationDate, password } = req.body;

    // Validate URL
    if (!url || !isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Generate or use custom short code
    let shortCode = customCode || generateShortCode();
    
    // Check if custom code already exists
    if (customCode) {
      const { data: existingUrl } = await supabase
        .from('urls')
        .select('short_code')
        .eq('short_code', customCode)
        .single();
      
      if (existingUrl) {
        return res.status(409).json({ error: 'Custom code already in use' });
      }
    }

    // Prepare data for insertion
    const urlData = {
      short_code: shortCode,
      original_url: url,
      clicks: 0,
    };

    // Add optional fields if provided
    if (expirationDate) {
      urlData.expires_at = new Date(expirationDate).toISOString();
    }

    if (password) {
      urlData.password_protected = true;
      urlData.password_hash = await hashPassword(password);
    }

    // Insert into database
    const { data, error } = await supabase
      .from('urls')
      .insert([urlData])
      .select();

    if (error) {
      console.error('Error inserting URL:', error);
      return res.status(500).json({ error: 'Failed to create short URL' });
    }

    // Return the shortened URL
    return res.status(201).json({
      shortUrl: `${process.env.URL_DOMAIN}/${shortCode}`,
      shortCode,
      originalUrl: url,
      ...data[0]
    });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

// File: pages/api/[shortCode].js
import supabase from '../../lib/supabase';
import { comparePassword } from '../../lib/utils';

export default async function handler(req, res) {
  // Get the short code from the URL
  const { shortCode } = req.query;
  const { password } = req.body;

  try {
    // Fetch the URL data
    const { data: url, error } = await supabase
      .from('urls')
      .select('*')
      .eq('short_code', shortCode)
      .single();

    if (error || !url) {
      return res.status(404).json({ error: 'URL not found' });
    }

    // Check if URL has expired
    if (url.expires_at && new Date(url.expires_at) < new Date()) {
      return res.status(410).json({ error: 'URL has expired' });
    }

    // Check if URL is password protected
    if (url.password_protected) {
      // For GET requests, we return that the URL is password protected
      if (req.method === 'GET') {
        return res.status(200).json({ 
          requiresPassword: true, 
          shortCode 
        });
      }
      
      // For POST requests, we check the provided password
      if (!password) {
        return res.status(401).json({ error: 'Password required' });
      }

      const passwordValid = await comparePassword(password, url.password_hash);
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid password' });
      }
    }

    // Increment click count
    if (req.method === 'GET' || (req.method === 'POST' && password)) {
      await supabase
        .from('urls')
        .update({ clicks: url.clicks + 1 })
        .eq('id', url.id);
    }

    // Return the original URL
    return res.status(200).json({ 
      originalUrl: url.original_url,
      redirectTo: url.original_url 
    });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

// File: pages/api/stats/[shortCode].js
import supabase from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { shortCode } = req.query;

  try {
    const { data: url, error } = await supabase
      .from('urls')
      .select('*')
      .eq('short_code', shortCode)
      .single();

    if (error || !url) {
      return res.status(404).json({ error: 'URL not found' });
    }

    return res.status(200).json({
      shortCode: url.short_code,
      originalUrl: url.original_url,
      clicks: url.clicks,
      createdAt: url.created_at,
      expiresAt: url.expires_at || null,
      isPasswordProtected: !!url.password_protected
    });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

// File: pages/index.js
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
  const [url, setUrl] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [password, setPassword] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setShortUrl('');
    setLoading(true);

    try {
      if (!url.trim()) {
        throw new Error('Please enter a URL');
      }

      // Add http protocol if missing
      let formattedUrl = url;
      if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
        formattedUrl = `https://${formattedUrl}`;
      }

      const response = await fetch('/api/shorten', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: formattedUrl,
          customCode: customCode || undefined,
          expirationDate: expirationDate || undefined,
          password: password || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create short URL');
      }

      setShortUrl(data.shortUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>URL Shortener</title>
        <meta name="description" content="Shorten your URLs with our service" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-8">URL Shortener</h1>
          
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="url" className="block text-gray-700 font-medium mb-2">
                  URL to shorten*
                </label>
                <input
                  type="text"
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/very/long/url"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label htmlFor="customCode" className="block text-gray-700 font-medium mb-2">
                  Custom short code (optional)
                </label>
                <input
                  type="text"
                  id="customCode"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  placeholder="my-custom-url"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div className="mb-4">
                <label htmlFor="expirationDate" className="block text-gray-700 font-medium mb-2">
                  Expiration date (optional)
                </label>
                <input
                  type="date"
                  id="expirationDate"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div className="mb-6">
                <label htmlFor="password" className="block text-gray-700 font-medium mb-2">
                  Password protection (optional)
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Set a password for your URL"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-2 px-4 rounded-md font-medium text-white ${
                  loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {loading ? 'Processing...' : 'Shorten URL'}
              </button>
            </form>
          </div>
          
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md mb-6">
              {error}
            </div>
          )}
          
          {shortUrl && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-md mb-6">
              <p className="font-bold mb-2">Your shortened URL:</p>
              <div className="flex items-center">
                <a
                  href={shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline break-all mr-2"
                >
                  {shortUrl}
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(shortUrl);
                    alert('URL copied to clipboard!');
                  }}
                  className="bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded-md text-sm"
                >
                  Copy
                </button>
              </div>
              <p className="mt-2">
                <Link
                  href={`/stats/${shortUrl.split('/').pop()}`}
                  className="text-blue-600 hover:underline"
                >
                  View statistics →
                </Link>
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// File: pages/[shortCode].js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function RedirectPage() {
  const router = useRouter();
  const { shortCode } = router.query;
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shortCode) return;

    async function fetchAndRedirect() {
      try {
        const response = await fetch(`/api/${shortCode}`, {
          method: 'GET',
        });
        
        const data = await response.json();
        
        if (response.ok) {
          if (data.requiresPassword) {
            setPasswordRequired(true);
            setLoading(false);
          } else {
            window.location.href = data.redirectTo;
          }
        } else {
          setError(data.error || 'URL not found');
          setLoading(false);
        }
      } catch (err) {
        setError('Failed to process URL');
        setLoading(false);
      }
    }

    fetchAndRedirect();
  }, [shortCode]);

  const handleSubmitPassword = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`/api/${shortCode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok) {
        window.location.href = data.redirectTo;
      } else {
        setError(data.error || 'Invalid password');
        setLoading(false);
      }
    } catch (err) {
      setError('Failed to process URL');
      setLoading(false);
    }
  };

  if (loading && !passwordRequired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Head>
          <title>Redirecting...</title>
        </Head>
        <div className="text-center">
          <p className="text-xl">Redirecting...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Head>
          <title>Error</title>
        </Head>
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error</h1>
          <p className="mb-4">{error}</p>
          <a
            href="/"
            className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md"
          >
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Head>
          <title>Password Protected URL</title>
        </Head>
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4">Password Protected URL</h1>
          <p className="mb-4">This URL is password protected. Please enter the password to continue.</p>
          
          <form onSubmit={handleSubmitPassword}>
            <div className="mb-4">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2 px-4 rounded-md font-medium text-white ${
                loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {loading ? 'Checking...' : 'Continue'}
            </button>
          </form>
          
          <div className="mt-4 text-center">
            <a href="/" className="text-blue-600 hover:underline">
              Back to Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// File: pages/stats/[shortCode].js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { formatDate } from '../../lib/utils';

export default function StatsPage() {
  const router = useRouter();
  const { shortCode } = router.query;
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shortCode) return;

    async function fetchStats() {
      try {
        const response = await fetch(`/api/stats/${shortCode}`);
        const data = await response.json();

        if (response.ok) {
          setStats(data);
        } else {
          setError(data.error || 'Failed to fetch statistics');
        }
      } catch (err) {
        setError('Server error');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [shortCode]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Head>
          <title>Loading Statistics...</title>
        </Head>
        <div className="text-center">
          <p className="text-xl">Loading statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Head>
          <title>Error</title>
        </Head>
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error</h1>
          <p className="mb-4">{error}</p>
          <Link
            href="/"
            className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>URL Statistics</title>
      </Head>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold">URL Statistics</h1>
              <Link
                href="/"
                className="text-blue-600 hover:underline"
              >
                Back to Home
              </Link>
            </div>

            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-2">Short URL</h2>
              <p className="break-all bg-gray-100 p-3 rounded-md">
                {`${process.env.NEXT_PUBLIC_URL_DOMAIN || window.location.origin}/${stats.shortCode}`}
              </p>
            </div>

            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-2">Original URL</h2>
              <p className="break-all bg-gray-100 p-3 rounded-md">
                <a
                  href={stats.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {stats.originalUrl}
                </a>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-100 p-4 rounded-md">
                <h2 className="text-lg font-semibold mb-2">Clicks</h2>
                <p className="text-3xl font-bold">{stats.clicks}</p>
              </div>

              <div className="bg-gray-100 p-4 rounded-md">
                <h2 className="text-lg font-semibold mb-2">Created On</h2>
                <p>{formatDate(stats.createdAt)}</p>
              </div>
            </div>

            {stats.expiresAt && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-2">Expires On</h2>
                <p className={`${
                  new Date(stats.expiresAt) < new Date() ? 'text-red-600' : ''
                }`}>
                  {formatDate(stats.expiresAt)}
                  {new Date(stats.expiresAt) < new Date() && ' (Expired)'}
                </p>
              </div>
            )}

            {stats.isPasswordProtected && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold">Security</h2>
                <p>This URL is password protected</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// File: tailwind.config.js
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

// File: next.config.js
module.exports = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/:shortCode',
        destination: '/[shortCode]',
        permanent: true,
      },
    ];
  },
}

// File: database-schema.sql
/*
-- Run this in Supabase SQL editor to create the necessary table structure

create table urls (
  id uuid default gen_random_uuid() primary key,
  short_code text unique not null,
  original_url text not null,
  created_at timestamp default now(),
  clicks int default 0,
  expires_at timestamp,
  password_protected boolean default false,
  password_hash text
);

-- Create index for faster lookups
create index idx_short_code on urls(short_code);
*/
