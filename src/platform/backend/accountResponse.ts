/** Supabase carries HTTP status beside its normalized error, including failed fetches. */
export function accountResponse<T>(response: {data: T; error: {message: string; code?: string} | null; status: number}): T {
    if (response.error) throw Object.assign(new Error(response.error.message), {code: response.error.code, status: response.status});
    return response.data;
}
