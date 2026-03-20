import { useState } from "react";
import { useCreateBoard, useAdLibraryFolders } from "@/hooks/useAdLibrary";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (boardId: string) => void;
}

export function NewBoardModal({ isOpen, onClose, onCreated }: Props) {
  const { data: folders = [] } = useAdLibraryFolders();
  const createBoard = useCreateBoard();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState<string>("");

  const handleCreate = () => {
    if (!name.trim()) return;
    createBoard.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        folder_id: folderId || undefined,
      },
      {
        onSuccess: (data) => {
          onCreated?.(data.id);
          resetAndClose();
        },
      }
    );
  };

  const resetAndClose = () => {
    setName("");
    setDescription("");
    setFolderId("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && resetAndClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">New Board</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-label">Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. DTC Winners Q1"
              className="h-9 text-sm"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-label">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this board for?"
              rows={2}
              className="text-sm"
            />
          </div>
          {folders.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-label">Folder</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="No folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No folder</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={resetAndClose}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={!name.trim() || createBoard.isPending}>
              {createBoard.isPending ? "Creating..." : "Create Board"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
