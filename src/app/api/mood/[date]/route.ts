// app/api/mood/[date]/route.ts - 删除特定日期的心情记录
import { NextRequest, NextResponse } from 'next/server';
import { createAuthDb } from '@/app/lib/supabase';

export async function DELETE(req: NextRequest, { params }: { params: { date: string } }) {
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
    const { date } = params;
    
    const { data, error } = await supabase.rpc('delete_mood_record', {
      user_uuid: userData.user.id,
      record_date: date
    });

    if (error) {
      console.error('Error deleting mood record:', error);
      return NextResponse.json({ error: 'Failed to delete mood record' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Mood record deleted successfully' });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
