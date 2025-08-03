// app/api/subscription/check-limit/route.ts - 检查使用限制
// app/api/subscription/status/route.ts - 获取订阅状态
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
    const { limit_type, increment = 1 } = body;

    if (!limit_type) {
      return NextResponse.json({ error: 'limit_type is required' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('check_usage_limit', {
      user_uuid: userData.user.id,
      limit_type,
      increment_count: increment
    });

    if (error) {
      console.error('Error checking usage limit:', error);
      return NextResponse.json({ error: 'Failed to check usage limit' }, { status: 500 });
    }

    return NextResponse.json({ limit_check: data?.[0] });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
