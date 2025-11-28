import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// Import Meeting type from Dashboard
export interface Meeting {
    id: string;
    title: string;
    date: string;
    duration?: number;
    participants?: string[];
    summary?: string;
    status?: string;
    [key: string]: any;
}

interface MeetingStore {
    meetings: Meeting[];
    currentMeeting: Meeting | null;
    isLoading: boolean;

    setMeetings: (meetings: Meeting[]) => void;
    setCurrentMeeting: (meeting: Meeting | null) => void;
    updateMeeting: (id: string, data: Partial<Meeting>) => void;
    deleteMeeting: (id: string) => void;
    addMeeting: (meeting: Meeting) => void;
    setLoading: (loading: boolean) => void;
}

export const useMeetingStore = create<MeetingStore>()(
    devtools(
        (set) => ({
            meetings: [],
            currentMeeting: null,
            isLoading: false,

            setMeetings: (meetings) => set(
                { meetings },
                false,
                'meeting/setMeetings'
            ),

            setCurrentMeeting: (meeting) => set(
                { currentMeeting: meeting },
                false,
                'meeting/setCurrent'
            ),

            updateMeeting: (id, data) => set(
                (state) => ({
                    meetings: state.meetings.map(m =>
                        m.id === id ? { ...m, ...data } : m
                    ),
                    currentMeeting: state.currentMeeting?.id === id
                        ? { ...state.currentMeeting, ...data }
                        : state.currentMeeting
                }),
                false,
                'meeting/update'
            ),

            addMeeting: (meeting) => set(
                (state) => ({
                    meetings: [meeting, ...state.meetings]
                }),
                false,
                'meeting/add'
            ),

            deleteMeeting: (id) => set(
                (state) => ({
                    meetings: state.meetings.filter(m => m.id !== id),
                    currentMeeting: state.currentMeeting?.id === id ? null : state.currentMeeting
                }),
                false,
                'meeting/delete'
            ),

            setLoading: (loading) => set(
                { isLoading: loading },
                false,
                'meeting/setLoading'
            ),
        }),
        { name: 'MeetingStore' } // DevTools name
    )
);
