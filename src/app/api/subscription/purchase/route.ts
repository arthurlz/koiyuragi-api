// app/api/subscription/purchase/route.ts - 处理购买（简化版，实际需要与应用商店验证）
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
    const { platform, product_id, transaction_id, receipt } = body;

    // 这里应该验证购买收据
    // iOS: 向 App Store 验证
    // Android: 向 Google Play 验证
    // 为了演示，我们假设验证通过
    
    const expiry_date = new Date();
    if (product_id.includes('yearly')) {
      expiry_date.setFullYear(expiry_date.getFullYear() + 1);
    } else {
      expiry_date.setMonth(expiry_date.getMonth() + 1);
    }

    const { data, error } = await supabase.rpc('create_subscription', {
      user_uuid: userData.user.id,
      platform_name: platform,
      product_id_param: product_id,
      transaction_id,
      expiry_date: expiry_date.toISOString(),
      payload: { receipt, verified_at: new Date().toISOString() }
    });

    if (error) {
      console.error('Error creating subscription:', error);
      return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 });
    }

    return NextResponse.json({ subscription_id: data, success: true });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}