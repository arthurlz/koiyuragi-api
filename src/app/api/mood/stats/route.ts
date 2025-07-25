// app/api/mood/stats/route.ts - 获取心情统计
import { NextRequest, NextResponse } from 'next/server';
import { createAuthDb } from '@/app/lib/supabase';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer /, '');
  
  if (!token) {
    return NextResponse.json({ error: 'No token provided' }, { status: 401 });
  }

  const supabase = createAuthDb(token);
  const { data: userData } = await supabase.auth.getUser(token);
  
  if (!userData.user?.id) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase.rpc('get_mood_statistics', {
      user_uuid: userData.user.id
    });

    if (error) {
      console.error('Error fetching mood statistics:', error);
      return NextResponse.json({ error: 'Failed to fetch mood statistics' }, { status: 500 });
    }

    return NextResponse.json({ stats: data?.[0] || null });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
