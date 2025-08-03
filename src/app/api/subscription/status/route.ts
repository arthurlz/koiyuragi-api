// app/api/subscription/status/route.ts - 获取订阅状态
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
    // 获取订阅状态
    const { data: subscriptionData, error: subError } = await supabase.rpc('get_user_subscription_status', {
      user_uuid: userData.user.id
    });

    if (subError) {
      console.error('Error fetching subscription status:', subError);
      return NextResponse.json({ error: 'Failed to fetch subscription status' }, { status: 500 });
    }

    // 获取使用统计
    const { data: usageData, error: usageError } = await supabase.rpc('get_usage_stats', {
      user_uuid: userData.user.id
    });

    if (usageError) {
      console.error('Error fetching usage stats:', usageError);
      return NextResponse.json({ error: 'Failed to fetch usage stats' }, { status: 500 });
    }

    const subscription = subscriptionData?.[0];
    const usage = usageData?.[0];

    return NextResponse.json({
      subscription: subscription || {
        is_premium: false,
        status: 'free',
        expires_at: null,
        plan_id: 'free',
        days_remaining: 0
      },
      usage: usage || {
        today_ai_messages: 0,
        today_image_uploads: 0,
        today_mood_records: 0,
        today_breathing_sessions: 0,
        weekly_ai_messages: 0,
        monthly_ai_messages: 0,
        is_premium: false,
        limits: {}
      }
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
