// app/api/mood/route.ts - 获取心情记录列表
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
  const limit = parseInt(searchParams.get('limit') || '30');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const { data, error } = await supabase.rpc('get_mood_records', {
      user_uuid: userData.user.id,
      limit_count: limit,
      offset_count: offset
    });

    if (error) {
      console.error('Error fetching mood records:', error);
      return NextResponse.json({ error: 'Failed to fetch mood records' }, { status: 500 });
    }

    return NextResponse.json({ records: data || [] });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
    const { date, score, note, tags } = body;

    // 验证必填字段
    if (!date || !score) {
      return NextResponse.json({ error: 'Date and score are required' }, { status: 400 });
    }

    // 验证评分范围
    if (score < 1 || score > 5) {
      return NextResponse.json({ error: 'Score must be between 1 and 5' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('save_mood_record', {
      user_uuid: userData.user.id,
      record_date: date,
      mood_score: score,
      mood_note: note || null,
      mood_tags: tags || null
    });

    if (error) {
      console.error('Error saving mood record:', error);
      return NextResponse.json({ error: 'Failed to save mood record' }, { status: 500 });
    }

    return NextResponse.json({ id: data, message: 'Mood record saved successfully' });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
