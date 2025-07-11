import { createClient } from '@supabase/supabase-js'

// Create a single supabase client for interacting with your database
export const supabase = createClient(process.env.SUPABASE_PROJECT_URL!,
  process.env.SUPABASE_ANON_KEY!)

export const createAuthDb = (jwt: string) => {
  return createClient(process.env.SUPABASE_PROJECT_URL!,
    process.env.SUPABASE_ANON_KEY!,
  {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    }
  })
}