class ApiError extends Error {
    constructor(
      statusCode,
      message = "SomeThing went wrong",
      errors = [],
      stack = ""
    ) {
      super(message);
      this.statusCode=statusCode;
      this.data=null;
      this.message=message;
      this.success=false;
      this.errors= errors;
    }

    /** Express/JSON.stringify skips Error.message unless we expose it here */
    toJSON() {
      return {
        statusCode: this.statusCode,
        message: this.message,
        data: this.data,
        success: this.success,
        // errors: this.errors,
      };
    }
  }
  
export {ApiError}