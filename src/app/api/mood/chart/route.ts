// app/api/mood/chart/route.ts - 获取图表数据
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

  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') || '7');

  try {
    const { data, error } = await supabase.rpc('get_mood_chart_data', {
      user_uuid: userData.user.id,
      days_count: days
    });

    if (error) {
      console.error('Error fetching chart data:', error);
      return NextResponse.json({ error: 'Failed to fetch chart data' }, { status: 500 });
    }

    // 转换数据格式供图表使用
    const chartData = (data || []).map((item, index) => ({
      value: item.score || 0,
      label: index === data.length - 1 ? '今日' : `-${data.length - 1 - index}d`,
      date: item.date
    }));

    return NextResponse.json({ chartData });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
