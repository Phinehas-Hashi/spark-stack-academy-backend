import express from "express";
import { randomUUID } from "node:crypto";
import { getFirestore } from "../config/firebase.js";
import { requireFirebaseUser } from "../middleware/auth.js";
import {
  getPesapalTransactionStatus,
  submitPesapalOrder
} from "../services/pesapal.js";

const router = express.Router();

function clean(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function getCourseAmount(course) {
  const candidates = [
    course?.price,
    course?.amount,
    course?.priceKES,
    course?.priceKsh
  ];

  const amount = candidates.find(
    (value) => typeof value === "number" && Number.isFinite(value)
  );

  return amount ?? null;
}

function normalizeStatus(status) {
  const text = String(
    status?.payment_status_description ||
      status?.description ||
      ""
  ).toUpperCase();

  const code = Number(status?.status_code);

  if (code === 1 || text.includes("COMPLETED")) {
    return "COMPLETED";
  }

  if (code === 2 || text.includes("FAILED")) {
    return "FAILED";
  }

  if (code === 3 || text.includes("REVERSED")) {
    return "REVERSED";
  }

  return "PENDING";
}

/**
 * Activates the student's existing enrollment after a verified
 * successful Pesapal payment.
 *
 * Enrollment ID:
 *   {uid}_{courseId}
 *
 * This is intentionally idempotent:
 * repeated IPNs/callbacks will not create duplicate enrollments
 * or reset the student's existing progress.
 */
async function activateEnrollment({
  db,
  payment,
  merchantReference,
  orderTrackingId,
  pesapalStatus
}) {
  if (!payment?.uid || !payment?.courseId) {
    throw new Error("Payment is missing uid or courseId.");
  }

  const enrollmentId = `${payment.uid}_${payment.courseId}`;
  const enrollmentRef = db.collection("enrollments").doc(enrollmentId);

  await db.runTransaction(async (transaction) => {
    const enrollmentSnapshot = await transaction.get(enrollmentRef);

    const existing = enrollmentSnapshot.exists
      ? enrollmentSnapshot.data()
      : {};

    const enrollmentData = {
      userId: payment.uid,
      courseId: payment.courseId,
      courseTitle:
        payment.courseTitle ||
        existing.courseTitle ||
        "Premium Course",

      paymentStatus: "paid",
      status: "active",

      paymentId: merchantReference,
      paymentProvider: "pesapal",
      paymentReference: merchantReference,
      orderTrackingId,

      amount: Number(payment.amount),
      currency: payment.currency || "KES",

      updatedAt: new Date(),

      // Preserve existing learning progress.
      progress:
        typeof existing.progress === "number"
          ? existing.progress
          : 0,

      completedLessons: Array.isArray(existing.completedLessons)
        ? existing.completedLessons
        : [],

      // Preserve an existing enrollment date.
      enrolledAt:
        existing.enrolledAt || new Date()
    };

    transaction.set(enrollmentRef, enrollmentData, {
      merge: true
    });
  });

  return enrollmentId;
}

/**
 * Verifies a Pesapal transaction and records the result.
 *
 * A COMPLETED payment is only accepted when:
 * - amount matches
 * - currency matches
 * - merchant reference matches
 *
 * After successful verification, the existing SSA enrollment
 * is activated.
 */
async function verifyAndRecordPayment(
  orderTrackingId,
  merchantReference
) {
  const db = getFirestore();

  const paymentRef = db
    .collection("payments")
    .doc(merchantReference);

  const existing = await paymentRef.get();

  if (!existing.exists) {
    throw new Error(
      "Payment record not found for merchant reference."
    );
  }

  const payment = existing.data();

  const status = await getPesapalTransactionStatus(
    orderTrackingId
  );

  const paymentStatus = normalizeStatus(status);

  const amountMatches =
    Number(status?.amount) === Number(payment.amount);

  const currencyMatches =
    String(status?.currency || "").toUpperCase() ===
    String(payment.currency || "").toUpperCase();

  const referenceMatches =
    String(status?.merchant_reference || "") ===
    merchantReference;

  /**
   * Never activate enrollment unless the completed
   * Pesapal transaction matches our original payment.
   */
  if (
    paymentStatus === "COMPLETED" &&
    (!amountMatches ||
      !currencyMatches ||
      !referenceMatches)
  ) {
    await paymentRef.update({
      status: "verification_failed",
      verificationError:
        "Pesapal transaction details did not match the original order.",
      pesapalStatus: status,
      verifiedAt: new Date()
    });

    throw new Error(
      "Pesapal transaction verification failed."
    );
  }

  /**
   * Record the latest verified Pesapal state.
   */
  await paymentRef.update({
    status: paymentStatus.toLowerCase(),
    pesapalStatus: status,
    orderTrackingId,

    confirmationCode:
      status?.confirmation_code || null,

    paymentMethod:
      status?.payment_method || null,

    paymentAccount:
      status?.payment_account || null,

    verifiedAt: new Date()
  });

  /**
   * Payment is fully verified.
   * Activate the existing enrollment.
   */
  let enrollmentId = null;

  if (paymentStatus === "COMPLETED") {
    enrollmentId = await activateEnrollment({
      db,
      payment,
      merchantReference,
      orderTrackingId,
      pesapalStatus: status
    });

    await paymentRef.update({
      enrollmentId,
      enrollmentStatus: "active",
      completedAt: new Date()
    });
  }

  return {
    paymentStatus,
    status,
    payment,
    enrollmentId
  };
}

/**
 * POST /api/payments/initialize
 *
 * Starts a Pesapal payment for an SSA course.
 *
 * The backend reads the course price from Firestore.
 * The frontend never supplies the trusted payment amount.
 */
router.post(
  "/initialize",
  requireFirebaseUser,
  async (req, res) => {
    try {
      const uid = req.firebaseUser.uid;

      const courseId = clean(
        req.body?.courseId,
        100
      );

      if (!courseId) {
        return res.status(400).json({
          success: false,
          error: "courseId is required."
        });
      }

      const db = getFirestore();

      const courseSnapshot = await db
        .collection("courses")
        .doc(courseId)
        .get();

      if (!courseSnapshot.exists) {
        return res.status(404).json({
          success: false,
          error: "Course not found."
        });
      }

      const course = courseSnapshot.data();

      const amount = getCourseAmount(course);

      if (amount === null || amount <= 0) {
        return res.status(400).json({
          success: false,
          error:
            "Course does not have a valid price."
        });
      }

      const userSnapshot = await db
        .collection("users")
        .doc(uid)
        .get();

      const user = userSnapshot.exists
        ? userSnapshot.data()
        : {};

      const email = clean(
        req.firebaseUser.email || user.email,
        160
      );

      const phone = clean(
        user.phone || user.phoneNumber,
        30
      );

      const fullName = clean(
        user.fullName ||
          user.displayName ||
          req.firebaseUser.name,
        120
      );

      const [
        firstName = "SSA",
        ...rest
      ] = fullName
        .split(/\s+/)
        .filter(Boolean);

      const lastName = rest.join(" ");

      if (!email && !phone) {
        return res.status(400).json({
          success: false,
          error:
            "A student email or phone number is required."
        });
      }

      const merchantReference =
        `SSA-${Date.now()}-${randomUUID().slice(0, 8)}`;

      const callbackUrl =
        process.env.PESAPAL_CALLBACK_URL;

      const notificationId =
        process.env.PESAPAL_IPN_ID;

      if (!callbackUrl || !notificationId) {
        return res.status(503).json({
          success: false,
          error:
            "Pesapal callback/IPN configuration is incomplete."
        });
      }

      const paymentRef = db
        .collection("payments")
        .doc(merchantReference);

      await paymentRef.set({
        uid,
        userId: uid,

        courseId,

        courseTitle: clean(
          course.title ||
            course.name ||
            course.courseName,
          150
        ),

        amount,
        currency: "KES",

        provider: "pesapal",

        merchantReference,

        status: "initiated",

        createdAt: new Date()
      });

      const order =
        await submitPesapalOrder({
          id: merchantReference,

          currency: "KES",

          amount,

          description:
            `SSA course: ${clean(
              course.title ||
                course.name ||
                courseId,
              80
            )}`,

          callback_url: callbackUrl,

          cancellation_url:
            process.env.PESAPAL_CANCELLATION_URL ||
            callbackUrl,

          notification_id: notificationId,

          billing_address: {
            email_address:
              email || undefined,

            phone_number:
              phone || undefined,

            country_code: "KE",

            first_name: firstName,

            last_name: lastName
          }
        });

      await paymentRef.update({
        status: "pending",

        orderTrackingId:
          order.order_tracking_id,

        redirectUrl:
          order.redirect_url,

        pesapalResponse: order
      });

      return res.json({
        success: true,

        merchantReference,

        orderTrackingId:
          order.order_tracking_id,

        redirectUrl:
          order.redirect_url
      });
    } catch (error) {
      console.error(
        "Payment initialization error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not initialize payment."
      });
    }
  }
);

/**
 * GET /api/payments/verify/:merchantReference
 *
 * Allows the authenticated student/frontend to
 * verify a payment after returning from Pesapal.
 */
router.get(
  "/verify/:merchantReference",
  requireFirebaseUser,
  async (req, res) => {
    try {
      const merchantReference = clean(
        req.params.merchantReference,
        80
      );

      const db = getFirestore();

      const paymentSnapshot = await db
        .collection("payments")
        .doc(merchantReference)
        .get();

      if (
        !paymentSnapshot.exists ||
        paymentSnapshot.data().uid !==
          req.firebaseUser.uid
      ) {
        return res.status(404).json({
          success: false,
          error: "Payment not found."
        });
      }

      const payment =
        paymentSnapshot.data();

      if (!payment.orderTrackingId) {
        return res.status(409).json({
          success: false,
          error:
            "Pesapal tracking ID is not available yet."
        });
      }

      const result =
        await verifyAndRecordPayment(
          payment.orderTrackingId,
          merchantReference
        );

      return res.json({
        success: true,

        status:
          result.paymentStatus,

        enrollmentId:
          result.enrollmentId,

        payment: result.payment
      });
    } catch (error) {
      console.error(
        "Payment verification error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not verify payment."
      });
    }
  }
);

/**
 * Pesapal IPN
 *
 * Pesapal can call this endpoint more than once.
 * The enrollment activation is safe to repeat.
 */
router.all("/ipn", async (req, res) => {
  const trackingId = clean(
    req.query.OrderTrackingId ||
      req.body?.OrderTrackingId,
    100
  );

  const merchantReference = clean(
    req.query.OrderMerchantReference ||
      req.body?.OrderMerchantReference,
    80
  );

  if (!trackingId || !merchantReference) {
    return res.status(400).json({
      orderNotificationType: "IPNCHANGE",
      status: 500,
      message:
        "Missing Pesapal identifiers."
    });
  }

  try {
    await verifyAndRecordPayment(
      trackingId,
      merchantReference
    );

    return res.json({
      orderNotificationType: "IPNCHANGE",

      orderTrackingId:
        trackingId,

      orderMerchantReference:
        merchantReference,

      status: 200
    });
  } catch (error) {
    console.error(
      "Pesapal IPN error:",
      error
    );

    return res.status(500).json({
      orderNotificationType: "IPNCHANGE",

      orderTrackingId:
        trackingId,

      orderMerchantReference:
        merchantReference,

      status: 500
    });
  }
});

/**
 * Pesapal browser callback
 *
 * Verifies the transaction server-side before
 * redirecting the student back to SSA.
 */
router.get("/callback", async (req, res) => {
  const trackingId = clean(
    req.query.OrderTrackingId,
    100
  );

  const merchantReference = clean(
    req.query.OrderMerchantReference,
    80
  );

  const frontendUrl =
    process.env.PAYMENT_RESULT_URL || "/";

  if (!trackingId || !merchantReference) {
    return res.redirect(
      `${frontendUrl}?payment=invalid`
    );
  }

  try {
    const result =
      await verifyAndRecordPayment(
        trackingId,
        merchantReference
      );

    const state =
      result.paymentStatus.toLowerCase();

    return res.redirect(
      `${frontendUrl}?payment=${encodeURIComponent(
        state
      )}&reference=${encodeURIComponent(
        merchantReference
      )}`
    );
  } catch (error) {
    console.error(
      "Pesapal callback error:",
      error
    );

    return res.redirect(
      `${frontendUrl}?payment=verification_failed&reference=${encodeURIComponent(
        merchantReference
      )}`
    );
  }
});

export default router;