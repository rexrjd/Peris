import { createClient } from '@supabase/supabase-js'

// These are Supabase publishable client credentials. They can be replaced later
// with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://chtktuadlsnqgiisdcom.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_8Jn_YIOHadU0ynPhR8IW9w_FHXIKNWl'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
