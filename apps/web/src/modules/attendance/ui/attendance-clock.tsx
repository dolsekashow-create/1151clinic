'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, LogOut, MapPin } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  toast,
} from '@erp/ui';
import { checkInAction, checkOutAction } from '../actions';
import type { OpenSession } from '../repository';

interface BranchOption {
  id: string;
  nameAr: string;
}

/**
 * ساعة الحضور — زرّا تسجيل الدخول والخروج.
 *
 * ⚠️ الموقع يُطلب من المتصفح **عند الضغط** لا عند فتح الصفحة: طلب الإذن بلا
 *    سبب ظاهر يدفع المستخدم لرفضه، ورفضه مرة يجعل استعادته متعبة.
 * ⚠️ الإحداثيات تُرسل كما هي والمسافة تُحسب في **قاعدة البيانات**. حسابها هنا
 *    كان يعني أن تعديل الاستجابة في المتصفح يزوّر الحضور.
 * ⚠️ الوقت لا يُرسل إطلاقًا — ساعة الخادم هي المرجع.
 */
export function AttendanceClock({
  openSession,
  branches,
}: {
  openSession: OpenSession | null;
  branches: readonly BranchOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');

  const since = useMemo(() => {
    if (!openSession) return null;
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
      timeZone: 'Asia/Riyadh',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(openSession.checkedInAt));
  }, [openSession]);

  /**
   * يطلب الموقع من المتصفح.
   * ⚠️ `enableHighAccuracy` ضروري: الموقع التقريبي من الشبكة قد يبعد كيلومترات
   *    فيرفضه النطاق ويظن الموظف أن النظام معطّل.
   */
  function requestPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('متصفحك لا يدعم تحديد الموقع'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, (err) => {
        const messages: Record<number, string> = {
          1: 'رفضت إذن الموقع. فعّله من إعدادات المتصفح ثم حاول مرة أخرى.',
          2: 'تعذّر تحديد موقعك. تأكد من تفعيل خدمة الموقع في جهازك.',
          3: 'استغرق تحديد الموقع وقتًا طويلًا. حاول مرة أخرى.',
        };
        reject(new Error(messages[err.code] ?? 'تعذّر تحديد موقعك'));
      }, {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0, // ⚠️ لا موقع مخزَّن: الحضور يحتاج موقعك الآن لا قبل ساعة
      });
    });
  }

  async function withPosition(run: (lat: number, lng: number, accuracy: number) => void) {
    setError(null);
    setLocating(true);
    try {
      const position = await requestPosition();
      run(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحديد موقعك');
    } finally {
      setLocating(false);
    }
  }

  function onCheckIn() {
    void withPosition((latitude, longitude, accuracy) => {
      startTransition(async () => {
        const result = await checkInAction({ branchId, latitude, longitude, accuracy });
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        toast.success(`تم تسجيل حضورك — على بُعد ${Math.round(result.data.distanceMeters)} م`);
        router.refresh();
      });
    });
  }

  function onCheckOut() {
    void withPosition((latitude, longitude, accuracy) => {
      startTransition(async () => {
        const result = await checkOutAction({ latitude, longitude, accuracy });
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        const hours = Math.floor(result.data.durationMinutes / 60);
        const minutes = result.data.durationMinutes % 60;
        toast.success(`تم تسجيل انصرافك — المدة ${hours} س ${minutes} د`);
        router.refresh();
      });
    });
  }

  const busy = pending || locating;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" aria-hidden />
          الحضور والانصراف
        </CardTitle>
        <CardDescription>
          يُطلب موقعك عند الضغط للتأكد من وجودك في المقر. لا يُتتبَّع موقعك في أي وقت آخر.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="danger" title="تعذّر التسجيل">
            {error}
          </Alert>
        ) : null}

        {openSession ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">جلسة مفتوحة</span>
              <Badge variant="success">{openSession.branchName}</Badge>
            </div>
            <p className="text-sm">
              سجّلت حضورك <strong>{since}</strong>
            </p>
            <Separator />
            <Button block variant="destructive" loading={busy} onClick={onCheckOut}>
              <LogOut aria-hidden />
              {locating ? 'جارٍ تحديد موقعك…' : 'تسجيل انصراف'}
            </Button>
          </>
        ) : branches.length === 0 ? (
          <Alert variant="warning" title="لا فرع مُسنَد إليك">
            تسجيل الحضور يتطلب أن تكون مُسنَدًا إلى فرع. راجع الإدارة.
          </Alert>
        ) : (
          <>
            {branches.length > 1 ? (
              <Select value={branchId} onValueChange={setBranchId} disabled={busy}>
                <SelectTrigger aria-label="الفرع">
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                الفرع: <strong>{branches[0]?.nameAr}</strong>
              </p>
            )}

            <Button block loading={busy} onClick={onCheckIn} disabled={!branchId}>
              <LogIn aria-hidden />
              {locating ? 'جارٍ تحديد موقعك…' : 'تسجيل حضور'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
