import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  createNewProduct,
  editProduct,
  getIndividualProduct,
  listProducts,
  removeProduct,
} from "./product.controller";

const productRouter = Router();

/*
 * The catalog list is PUBLIC (like GET /api/faqs): the customer website
 * shows products to signed-out visitors, and the payload contains only
 * active rows' marketing data (name/category/description/unit/price).
 */
productRouter.get("/", listProducts);

productRouter.get(
  "/:productId",
  authenticateFirebase,
  loadDacsUser,
  getIndividualProduct
);

/*
 * Operational product management is staff-only.
 */
productRouter.post(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  createNewProduct
);

productRouter.patch(
  "/:productId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  editProduct
);

productRouter.delete(
  "/:productId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  removeProduct
);

export { productRouter };
