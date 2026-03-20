import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useSavedAds, SavedAd } from "@/hooks/useAdLibrary";
import { AdLibraryCard } from "@/components/ad-library/AdLibraryCard";
import { CollectionSidebar } from "@/components/ad-library/CollectionSidebar";
import { SaveAdModal } from "@/components/ad-library/SaveAdModal";
import { AdDetailPanel } from "@/components/ad-library/AdDetailPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Search, Library } from "lucide-react";

export default function AdLibraryPage() {
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [selectedAd, setSelectedAd] = useState<SavedAd | null>(null);

  const { data: ads = [], isLoading } = useSavedAds({
    collection_id: selectedCollectionId || undefined,
    search: search || undefined,
  });

  return (
    <AppLayout>
      <div className="flex h-full">
        {/* Collection sidebar */}
        <CollectionSidebar
          selectedCollectionId={selectedCollectionId}
          onSelect={setSelectedCollectionId}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 pt-6 pb-4">
            <PageHeader
              title="Ad Library"
              description="Save, organize, and reference ads from across the web"
            />
            <div className="flex items-center gap-3 mt-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sage" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search saved ads..."
                  className="pl-9 h-9 text-[13px]"
                />
              </div>
              <Button onClick={() => setShowSaveModal(true)} size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Save Ad
              </Button>
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="aspect-[4/3] bg-muted rounded-card animate-pulse" />
                ))}
              </div>
            ) : ads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Library className="h-12 w-12 text-sage/20 mb-4" />
                <p className="font-heading text-base text-charcoal mb-1">No ads saved yet</p>
                <p className="font-body text-[13px] text-sage mb-4">
                  Start building your swipe file by saving ads you find inspiring.
                </p>
                <Button onClick={() => setShowSaveModal(true)} size="sm" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Save Your First Ad
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {ads.map((ad) => (
                  <AdLibraryCard key={ad.id} ad={ad} onClick={() => setSelectedAd(ad)} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedAd && (
          <AdDetailPanel ad={selectedAd} onClose={() => setSelectedAd(null)} />
        )}
      </div>

      <SaveAdModal open={showSaveModal} onOpenChange={setShowSaveModal} />
    </AppLayout>
  );
}
