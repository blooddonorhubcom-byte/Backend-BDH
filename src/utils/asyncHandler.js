import { StatusCodes } from "http-status-codes";

export const asyncHandler = (requestHandler) => async(req, res, next) => {
    try {
        await requestHandler(req, res, next);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        const statusCode =
            typeof error?.statusCode === "number"
                ? error.statusCode
                : StatusCodes.INTERNAL_SERVER_ERROR;
        return res.status(statusCode).send({ status: false, message });
    }
}