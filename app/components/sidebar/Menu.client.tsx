import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { HelpButton } from '~/components/ui/SettingsButton';
import { IconButton } from '~/components/ui/IconButton';
import { Button } from '~/components/ui/Button';
import { db, deleteById, getAll, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { profileStore } from '~/lib/stores/profile';
import {
  COLOR_SCHEMES,
  COLOR_SCHEME_META,
  colorSchemeStore,
  setColorScheme,
  type ColorScheme,
} from '~/lib/stores/theme';

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: '-340px',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent =
  | { type: 'delete'; item: ChatHistoryItem }
  | { type: 'bulkDelete'; items: ChatHistoryItem[] }
  | null;

function CurrentDateTime() {
  const [dateTime, setDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/50">
      <div className="h-4 w-4 i-ph:clock opacity-80" />
      <div className="flex gap-2">
        <span>{dateTime.toLocaleDateString()}</span>
        <span>{dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

export const Menu = () => {
  const { duplicateCurrentChat, exportChat, startNewChat } = useChatHistory();
  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ChatHistoryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const profile = useStore(profileStore);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const activeScheme = useStore(colorSchemeStore);

  const { filteredItems: filteredList, handleSearchChange } = useSearchFilter({
    items: list,
    searchFields: ['description'],
  });

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        .then((list) => list.filter((item) => item.urlId && item.description))
        .then(setList)
        .catch((error) => toast.error(error.message));
    }
  }, []);

  const deleteChat = useCallback(
    async (id: string): Promise<void> => {
      if (!db) {
        throw new Error('Database not available');
      }

      // Delete chat snapshot from localStorage
      try {
        const snapshotKey = `snapshot:${id}`;
        localStorage.removeItem(snapshotKey);
        console.log('Removed snapshot for chat:', id);
      } catch (snapshotError) {
        console.error(`Error deleting snapshot for chat ${id}:`, snapshotError);
      }

      // Delete the chat from the database
      await deleteById(db, id);
      console.log('Successfully deleted chat:', id);
    },
    [db],
  );

  const deleteItem = useCallback(
    (event: React.UIEvent, item: ChatHistoryItem) => {
      event.preventDefault();
      event.stopPropagation();

      // Log the delete operation to help debugging
      console.log('Attempting to delete chat:', { id: item.id, description: item.description });

      deleteChat(item.id)
        .then(() => {
          toast.success('Chat deleted successfully', {
            position: 'bottom-right',
            autoClose: 3000,
          });

          // Always refresh the list
          loadEntries();

          if (chatId.get() === item.id) {
            // hard page navigation to clear the stores
            console.log('Navigating away from deleted chat');
            window.location.pathname = '/';
          }
        })
        .catch((error) => {
          console.error('Failed to delete chat:', error);
          toast.error('Failed to delete conversation', {
            position: 'bottom-right',
            autoClose: 3000,
          });

          // Still try to reload entries in case data has changed
          loadEntries();
        });
    },
    [loadEntries, deleteChat],
  );

  const deleteSelectedItems = useCallback(
    async (itemsToDeleteIds: string[]) => {
      if (!db || itemsToDeleteIds.length === 0) {
        console.log('Bulk delete skipped: No DB or no items to delete.');
        return;
      }

      console.log(`Starting bulk delete for ${itemsToDeleteIds.length} chats`, itemsToDeleteIds);

      let deletedCount = 0;
      const errors: string[] = [];
      const currentChatId = chatId.get();
      let shouldNavigate = false;

      // Process deletions sequentially using the shared deleteChat logic
      for (const id of itemsToDeleteIds) {
        try {
          await deleteChat(id);
          deletedCount++;

          if (id === currentChatId) {
            shouldNavigate = true;
          }
        } catch (error) {
          console.error(`Error deleting chat ${id}:`, error);
          errors.push(id);
        }
      }

      // Show appropriate toast message
      if (errors.length === 0) {
        toast.success(`${deletedCount} chat${deletedCount === 1 ? '' : 's'} deleted successfully`);
      } else {
        toast.warning(`Deleted ${deletedCount} of ${itemsToDeleteIds.length} chats. ${errors.length} failed.`, {
          autoClose: 5000,
        });
      }

      // Reload the list after all deletions
      await loadEntries();

      // Clear selection state
      setSelectedItems([]);
      setSelectionMode(false);

      // Navigate if needed
      if (shouldNavigate) {
        console.log('Navigating away from deleted chat');
        window.location.pathname = '/';
      }
    },
    [deleteChat, loadEntries, db],
  );

  const closeDialog = () => {
    setDialogContent(null);
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);

    if (selectionMode) {
      // If turning selection mode OFF, clear selection
      setSelectedItems([]);
    }
  };

  const toggleItemSelection = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const newSelectedItems = prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id];
      console.log('Selected items updated:', newSelectedItems);

      return newSelectedItems; // Return the new array
    });
  }, []); // No dependencies needed

  const handleBulkDeleteClick = useCallback(() => {
    if (selectedItems.length === 0) {
      toast.info('Select at least one chat to delete');
      return;
    }

    const selectedChats = list.filter((item) => selectedItems.includes(item.id));

    if (selectedChats.length === 0) {
      toast.error('Could not find selected chats');
      return;
    }

    setDialogContent({ type: 'bulkDelete', items: selectedChats });
  }, [selectedItems, list]); // Keep list dependency

  const selectAll = useCallback(() => {
    const allFilteredIds = filteredList.map((item) => item.id);
    setSelectedItems((prev) => {
      const allFilteredAreSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => prev.includes(id));

      if (allFilteredAreSelected) {
        // Deselect only the filtered items
        const newSelectedItems = prev.filter((id) => !allFilteredIds.includes(id));
        console.log('Deselecting all filtered items. New selection:', newSelectedItems);

        return newSelectedItems;
      } else {
        // Select all filtered items, adding them to any existing selections
        const newSelectedItems = [...new Set([...prev, ...allFilteredIds])];
        console.log('Selecting all filtered items. New selection:', newSelectedItems);

        return newSelectedItems;
      }
    });
  }, [filteredList]); // Depends only on filteredList

  useEffect(() => {
    if (open) {
      loadEntries();
    }
  }, [open, loadEntries]);

  // Exit selection mode when sidebar is closed
  useEffect(() => {
    if (!open && selectionMode) {
      /*
       * Don't clear selection state anymore when sidebar closes
       * This allows the selection to persist when reopening the sidebar
       */
      console.log('Sidebar closed, preserving selection state');
    }
  }, [open, selectionMode]);

  useEffect(() => {
    const enterThreshold = 20;
    const exitThreshold = 20;

    function onMouseMove(event: MouseEvent) {
      if (event.pageX < enterThreshold) {
        setOpen(true);
      }

      if (menuRef.current && event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold) {
        setOpen(false);
      }
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  const handleDuplicate = async (id: string) => {
    await duplicateCurrentChat(id);
    loadEntries(); // Reload the list after duplication
  };

  const setDialogContentWithLogging = useCallback((content: DialogContent) => {
    console.log('Setting dialog content:', content);
    setDialogContent(content);
  }, []);

  return (
    <>
      <motion.div
        ref={menuRef}
        initial="closed"
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        style={{ width: '340px' }}
        data-theme="dark"
        className={classNames(
          'flex selection-accent flex-col side-menu fixed top-0 h-full rounded-r-2xl',
          'bg-gray-950 border-r border-bolt-elements-borderColor',
          'shadow-sm text-sm z-sidebar',
        )}
      >
        <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/50 rounded-tr-2xl">
          <div className="text-gray-900 dark:text-white font-medium"></div>
          <div className="flex items-center gap-3">
            <HelpButton onClick={() => window.open('https://stackblitz-labs.github.io/bolt.diy/', '_blank')} />
            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
              {profile?.username || 'Guest User'}
            </span>
            <div className="flex items-center justify-center w-[32px] h-[32px] overflow-hidden bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-500 rounded-full shrink-0">
              {profile?.avatar ? (
                <img
                  src={profile.avatar}
                  alt={profile?.username || 'User'}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="sync"
                />
              ) : (
                <div className="i-ph:user-fill text-lg" />
              )}
            </div>
          </div>
        </div>
        <CurrentDateTime />
        <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  startNewChat();
                  setOpen(false);
                }}
                className="flex-1 flex gap-2 items-center scheme-accent-soft rounded-lg px-4 py-2"
              >
                <span className="inline-block i-ph:plus-circle h-4 w-4" />
                <span className="text-sm font-medium">Start new chat</span>
              </button>
              <button
                onClick={toggleSelectionMode}
                className={classNames(
                  'flex gap-1 items-center rounded-lg px-3 py-2 transition-colors border',
                  selectionMode
                    ? 'scheme-accent-solid border-transparent'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700',
                )}
                aria-label={selectionMode ? 'Exit selection mode' : 'Enter selection mode'}
              >
                <span className={selectionMode ? 'i-ph:x h-4 w-4' : 'i-ph:check-square h-4 w-4'} />
              </button>
            </div>
            <div className="relative w-full">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <span className="i-ph:magnifying-glass h-4 w-4 text-gray-400 dark:text-gray-500" />
              </div>
              <input
                className="w-full bg-gray-50 dark:bg-gray-900 relative pl-9 pr-3 py-2 rounded-lg focus:outline-none scheme-accent-ring text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-800"
                type="search"
                placeholder="Search chats..."
                onChange={handleSearchChange}
                aria-label="Search chats"
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-sm px-4 py-2">
            <div className="font-medium text-gray-600 dark:text-gray-400">Your Chats</div>
            {selectionMode && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  {selectedItems.length === filteredList.length ? 'Deselect all' : 'Select all'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDeleteClick}
                  disabled={selectedItems.length === 0}
                >
                  Delete selected
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto px-3 pb-3">
            {filteredList.length === 0 && (
              <div className="px-4 text-gray-500 dark:text-gray-400 text-sm">
                {list.length === 0 ? 'No previous conversations' : 'No matches found'}
              </div>
            )}
            <DialogRoot open={dialogContent !== null}>
              {binDates(filteredList).map(({ category, items }) => (
                <div key={category} className="mt-2 first:mt-0 space-y-1">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 sticky top-0 z-1 bg-white dark:bg-gray-950 px-4 py-1">
                    {category}
                  </div>
                  <div className="space-y-0.5 pr-1">
                    {items.map((item) => (
                      <HistoryItem
                        key={item.id}
                        item={item}
                        exportChat={exportChat}
                        onDelete={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          console.log('Delete triggered for item:', item);
                          setDialogContentWithLogging({ type: 'delete', item });
                        }}
                        onDuplicate={() => handleDuplicate(item.id)}
                        selectionMode={selectionMode}
                        isSelected={selectedItems.includes(item.id)}
                        onToggleSelection={toggleItemSelection}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
                {dialogContent?.type === 'delete' && (
                  <>
                    <div className="p-6 bg-white dark:bg-gray-950">
                      <DialogTitle className="text-gray-900 dark:text-white">Delete Chat?</DialogTitle>
                      <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                        <p>
                          You are about to delete{' '}
                          <span className="font-medium text-gray-900 dark:text-white">
                            {dialogContent.item.description}
                          </span>
                        </p>
                        <p className="mt-2">Are you sure you want to delete this chat?</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Cancel
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={(event) => {
                          console.log('Dialog delete button clicked for item:', dialogContent.item);
                          deleteItem(event, dialogContent.item);
                          closeDialog();
                        }}
                      >
                        Delete
                      </DialogButton>
                    </div>
                  </>
                )}
                {dialogContent?.type === 'bulkDelete' && (
                  <>
                    <div className="p-6 bg-white dark:bg-gray-950">
                      <DialogTitle className="text-gray-900 dark:text-white">Delete Selected Chats?</DialogTitle>
                      <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                        <p>
                          You are about to delete {dialogContent.items.length}{' '}
                          {dialogContent.items.length === 1 ? 'chat' : 'chats'}:
                        </p>
                        <div className="mt-2 max-h-32 overflow-auto border border-gray-100 dark:border-gray-800 rounded-md bg-gray-50 dark:bg-gray-900 p-2">
                          <ul className="list-disc pl-5 space-y-1">
                            {dialogContent.items.map((item) => (
                              <li key={item.id} className="text-sm">
                                <span className="font-medium text-gray-900 dark:text-white">{item.description}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <p className="mt-3">Are you sure you want to delete these chats?</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Cancel
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={() => {
                          /*
                           * Pass the current selectedItems to the delete function.
                           * This captures the state at the moment the user confirms.
                           */
                          const itemsToDeleteNow = [...selectedItems];
                          console.log('Bulk delete confirmed for', itemsToDeleteNow.length, 'items', itemsToDeleteNow);
                          deleteSelectedItems(itemsToDeleteNow);
                          closeDialog();
                        }}
                      >
                        Delete
                      </DialogButton>
                    </div>
                  </>
                )}
              </Dialog>
            </DialogRoot>
          </div>
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-800 px-4 py-3">
            <div className="flex items-center gap-3">
              <IconButton
                onClick={() => setThemePanelOpen(true)}
                icon="i-ph:palette"
                size="xl"
                title="Theme"
                data-testid="theme-button"
                className="text-[#666] hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive/10 transition-colors"
              />
            </div>
            <div className="flex items-center gap-3">
              <IconButton
                onClick={() => {
                  if (typeof document === 'undefined') {
                    return;
                  }

                  const el = document.documentElement;

                  if (!document.fullscreenElement) {
                    if (el.requestFullscreen) {
                      el.requestFullscreen().catch((err: unknown) => console.error('Fullscreen error:', err));
                    }
                  } else if (document.exitFullscreen) {
                    document.exitFullscreen().catch((err: unknown) => console.error('Exit fullscreen error:', err));
                  }
                }}
                icon="i-ph:corners-out"
                size="xl"
                title="Maximize"
                data-testid="maximize-button"
                className="text-[#666] hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive/10 transition-colors"
              />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Theme picker dialog — opened by the palette icon in the sidebar footer. */}
      <DialogRoot open={themePanelOpen} onOpenChange={setThemePanelOpen}>
        <Dialog onClose={() => setThemePanelOpen(false)} className="max-w-[440px]">
          <div className="p-6 bg-white dark:bg-gray-950">
            <div className="flex items-center gap-2 mb-1">
              <div className="i-ph:palette text-2xl text-bolt-elements-textPrimary" />
              <DialogTitle>Theme</DialogTitle>
            </div>
            <DialogDescription className="mb-5">
              Pick a color palette. Choose from seven green shades or the Classic Purple — the original bolt.diy accent. Your choice is saved instantly and applies across the whole app.
            </DialogDescription>
            <div className="grid grid-cols-2 gap-3">
              {COLOR_SCHEMES.map((scheme: ColorScheme) => {
                const meta = COLOR_SCHEME_META[scheme];
                const isActive = activeScheme === scheme;
                return (
                  <button
                    key={scheme}
                    type="button"
                    onClick={() => setColorScheme(scheme)}
                    className={classNames(
                      'flex items-center gap-3 p-3 rounded-lg border transition-all text-left',
                      isActive
                        ? 'border-transparent'
                        : 'border-bolt-elements-borderColor hover:bg-bolt-elements-item-backgroundActive',
                    )}
                    style={
                      isActive
                        ? ({
                            backgroundColor: `${meta.swatch}1a`,
                            boxShadow: `0 0 0 2px ${meta.swatch}`,
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    <span
                      className="w-8 h-8 rounded-full shrink-0 border border-white/10"
                      style={{ backgroundColor: meta.swatch, boxShadow: `0 0 12px ${meta.swatch}80` }}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">
                        {meta.name}
                      </span>
                      <span className="text-xs text-bolt-elements-textTertiary truncate">{meta.description}</span>
                    </div>
                    {isActive && (
                      <div
                        className="i-ph:check-bold ml-auto shrink-0"
                        style={{ color: meta.swatch }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-5">
              <Button variant="outline" onClick={() => setThemePanelOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </Dialog>
      </DialogRoot>
    </>
  );
};
