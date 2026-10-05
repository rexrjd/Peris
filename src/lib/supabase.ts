import { createClient } from '@supabase/supabase-js'
const url=import.meta.env.VITE_SUPABASE_URL || 'https://chtktuadlsnqgiisdcom.supabase.co'
const key=import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_8Jn_YIOHadU0ynPhR8IW9w_FHXIKNWl'
// A publishable browser key. Server rules, not this key, authorize game actions.
export const supabase=createClient(url,key)
