// app/api/subscription/record-usage/route.ts - 记录使用量

import { NextRequest, NextResponse } from 'next/server';
import { createAuthDb } from '@/app/lib/supabase';

export async function POST(req: NextRequest) {
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
    const body = await req.json();
    const { usage_type, count = 1 } = body;

    if (!usage_type) {
      return NextResponse.json({ error: 'usage_type is required' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('record_usage', {
      user_uuid: userData.user.id,
      usage_type,
      count_increment: count
    });

    if (error) {
      console.error('Error recording usage:', error);
      return NextResponse.json({ error: 'Failed to record usage' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
