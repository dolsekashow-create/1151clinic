/**
 * @erp/ui — نظام التصميم.
 *
 * قواعد:
 * • مكوّنات عرض فقط — بلا منطق عمل وبلا استدعاءات بيانات.
 * • كل الأنماط مبنية على خصائص منطقية (start/end) لتعمل في RTL و LTR.
 * • الألوان تُستهلك من متغيرات النظام (bg-primary…) لا قيم ثابتة.
 */

export { cn } from './lib/cn';
export { UIProvider } from './components/providers';

export { Button, buttonVariants, type ButtonProps } from './components/button';
export { Input, Textarea, DatePicker, inputBaseClass, type InputProps } from './components/input';
export { Field, Label, type FieldProps } from './components/field';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/select';

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card';
export { Badge, badgeVariants, type BadgeProps } from './components/badge';
export { Alert, type AlertProps } from './components/alert';

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  type TableCellProps,
  type TableHeadProps,
} from './components/table';
export { Pagination, type PaginationProps } from './components/pagination';

export { Modal, ModalClose, ModalContent, ModalTrigger, type ModalContentProps } from './components/modal';
export { Drawer, DrawerClose, DrawerContent, DrawerTrigger, type DrawerContentProps } from './components/drawer';
export {
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownGroup,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from './components/dropdown';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';

export {
  EmptyState,
  ErrorState,
  LoadingState,
  Skeleton,
  Spinner,
  TableSkeleton,
  type EmptyStateProps,
  type ErrorStateProps,
} from './components/feedback';
export { Toaster, toast } from './components/toast';
export {
  PageHeader,
  Separator,
  StatCard,
  type PageHeaderProps,
  type StatCardProps,
} from './components/layout';
