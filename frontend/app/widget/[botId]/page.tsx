import ChatWidget from '@/components/ChatWidget';

interface Props { params: { botId: string } }

export default function WidgetPage({ params }: Props) {
  return (
    <div className="flex h-screen items-stretch bg-background p-0">
      <div className="flex-1">
        <ChatWidget botId={params.botId} botName="Asistente" isPublic />
      </div>
    </div>
  );
}
