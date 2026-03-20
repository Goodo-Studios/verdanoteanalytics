import { useParams } from "react-router-dom";
import { SharedBoardView } from "@/features/ad-library/components/SharedBoardView";

export default function SharedAdBoardPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  if (!shareToken) return null;
  return <SharedBoardView shareToken={shareToken} />;
}
